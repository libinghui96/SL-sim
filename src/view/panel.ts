import { portOpenings, type PortOpenings } from '../sim/engine';
import type { LocoSim, Mode, Warning } from '../sim/loco';
import { KGF_CM2, P_ATM } from '../sim/steam';
import { pressureCss } from './colors';
import type { LocoView } from './scene';

export interface AppState {
  paused: boolean;
  timeScale: number;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const WARNING_TEXT: Record<Warning, string> = {
  lowWater: '水位过低',
  dryBoiler: '锅炉缺水干烧',
  highWater: '水位过高',
  safety: '安全阀起跳',
  noFuel: '燃料耗尽',
  noOil: '润滑油耗尽',
  slip: '动轮空转',
  tenderEmpty: '水柜无水',
};

type SliderKey = 'regulator' | 'reverser' | 'blower' | 'fuelValve' | 'bypass';
type ToggleKey = 'drains' | 'fan' | 'blowdown';
const SLIDERS: SliderKey[] = ['regulator', 'reverser', 'blower', 'fuelValve', 'bypass'];
const TOGGLES: ToggleKey[] = ['drains', 'fan', 'blowdown'];

export class Panel {
  private readonly readouts: [string, () => string][];
  private readonly cells: HTMLElement[] = [];
  private readonly open: PortOpenings = { admFront: 0, admBack: 0, exhFront: 0, exhBack: 0 };
  private eventsFor = NaN;
  private frame = 0;

  constructor(
    private readonly sim: LocoSim,
    view: LocoView,
    state: AppState,
  ) {
    const c = sim.controls;
    for (const key of SLIDERS) {
      const input = $<HTMLInputElement>(key);
      input.addEventListener('input', () => {
        c[key] = Number(input.value) / 100;
        $(key + 'Out').textContent = input.value + '%';
      });
    }
    for (const key of TOGGLES) {
      const input = $<HTMLInputElement>(key);
      input.addEventListener('change', () => (c[key] = input.checked));
    }
    $('ignite').addEventListener('click', () => sim.ignite());
    $('extinguish').addEventListener('click', () => sim.extinguish());
    $('handPump').addEventListener('click', () => sim.handPump());
    $('pushFwd').addEventListener('click', () => sim.push(0.05));
    $('pushBack').addEventListener('click', () => sim.push(-0.05));
    $('fillFuel').addEventListener('click', () => sim.fillFuel());
    $('fillTender').addEventListener('click', () => sim.fillTender());
    $('fillOil').addEventListener('click', () => sim.fillOil());
    const whistle = $('whistle');
    const blow = (on: boolean) => {
      c.whistle = on;
      whistle.classList.toggle('on', on);
    };
    whistle.addEventListener('pointerdown', () => blow(true));
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) whistle.addEventListener(ev, () => blow(false));

    $('presetCold').addEventListener('click', () => {
      sim.resetCold();
      this.syncControls();
    });
    $('presetHot').addEventListener('click', () => {
      sim.resetHot();
      this.syncControls();
    });
    const mode = $<HTMLSelectElement>('mode');
    mode.addEventListener('change', () => {
      sim.mode = mode.value as Mode;
      sim.v = 0;
    });
    const timeScale = $<HTMLSelectElement>('timeScale');
    timeScale.addEventListener('change', () => (state.timeScale = Number(timeScale.value)));
    const paused = $<HTMLInputElement>('paused');
    paused.addEventListener('change', () => (state.paused = paused.checked));
    const xray = $<HTMLInputElement>('xray');
    xray.addEventListener('change', () => view.setXray(xray.checked));
    const trainMass = $<HTMLInputElement>('trainMass');
    trainMass.addEventListener('change', () => (sim.params.track.trainMass = Math.max(0, Number(trainMass.value) || 0)));
    const grade = $<HTMLInputElement>('grade');
    grade.addEventListener('change', () => (sim.params.track.gradePermil = Number(grade.value) || 0));

    const e = sim.engine;
    const b = sim.boiler;
    const kgf = (P: number) => ((P - P_ATM) / KGF_CM2).toFixed(2) + ' kgf/cm²';
    this.readouts = [
      ['锅炉压力', () => (b.gaugePressure / KGF_CM2).toFixed(2) + ' kgf/cm²'],
      ['汽室压力', () => kgf(e.chestP)],
      ['锅炉温度', () => (b.T - 273.15).toFixed(0) + ' °C'],
      ['水位（玻璃管）', () => (Math.min(1.2, Math.max(-0.2, b.glass)) * 100).toFixed(0) + ' %'],
      ['速度', () => `${sim.v.toFixed(2)} m/s（实车 ${sim.speedScaleKmh.toFixed(0)} km/h）`],
      ['动轮转速', () => (sim.omega / (2 * Math.PI)).toFixed(1) + ' r/s'],
      ['牵引力', () => sim.tractiveForce.toFixed(1) + ' N'],
      ['指示功率', () => sim.indicatedPower.toFixed(1) + ' W'],
      ['耗汽量', () => (sim.steamFlow * 1e3).toFixed(3) + ' g/s'],
      ['给水量', () => (sim.feedFlow * 1e3).toFixed(3) + ' g/s'],
      ['火力', () => (sim.lit ? (sim.fireGain * 100).toFixed(0) + ' %' : '未点火')],
      ['过热度', () => sim.superheat.toFixed(0) + ' K'],
      ['缸壁温度 左 / 右', () => `${(e.wallT[0] - 273.15).toFixed(0)} / ${(e.wallT[1] - 273.15).toFixed(0)} °C`],
      ['燃料', () => (sim.fuel * 1e6).toFixed(0) + ' mL'],
      ['水柜', () => (sim.tenderWater * 1e6).toFixed(0) + ' mL'],
      ['润滑油', () => (sim.oil * 100).toFixed(0) + ' %'],
    ];
    const table = $('readouts');
    for (const [label] of this.readouts) {
      const row = table.appendChild(document.createElement('tr'));
      row.appendChild(document.createElement('td')).textContent = label;
      this.cells.push(row.appendChild(document.createElement('td')));
    }
    this.syncControls();
  }

  private syncControls(): void {
    const c = this.sim.controls;
    for (const key of SLIDERS) {
      const v = Math.round(c[key] * 100).toString();
      $<HTMLInputElement>(key).value = v;
      $(key + 'Out').textContent = v + '%';
    }
    for (const key of TOGGLES) $<HTMLInputElement>(key).checked = c[key];
  }

  update(): void {
    const sim = this.sim;
    this.drawPressure();
    this.drawGlass();
    this.drawIndicator();
    this.drawSection();
    if (this.frame++ % 6 !== 0) return;

    this.readouts.forEach(([, value], i) => (this.cells[i].textContent = value()));
    const t = Math.floor(sim.time);
    $('clock').textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')} · ${sim.distance.toFixed(1)} m`;
    const warnings = $('warnings');
    warnings.replaceChildren(
      ...sim.warnings().map((w) => {
        const s = document.createElement('span');
        s.textContent = WARNING_TEXT[w];
        return s;
      }),
    );
    if (sim.controls.reverser !== this.eventsFor) {
      this.eventsFor = sim.controls.reverser;
      const ev = sim.gear.events(this.eventsFor);
      const mm = (x: number) => (x * 1e3).toFixed(2);
      const rows: [string, string, string][] = [
        ['', '前端', '后端'],
        ['导程 mm', mm(ev.front.lead), mm(ev.back.lead)],
        ['最大汽口开度 mm', mm(ev.front.maxOpening), mm(ev.back.maxOpening)],
        ['截断 %', ev.front.cutoff.toFixed(0), ev.back.cutoff.toFixed(0)],
        ['排汽开始 %', ev.front.release.toFixed(0), ev.back.release.toFixed(0)],
        ['压缩开始 %', ev.front.compression.toFixed(0), ev.back.compression.toFixed(0)],
        ['阀行程 mm', mm(ev.travel), ''],
      ];
      $('events').replaceChildren(
        ...rows.map((r) => {
          const tr = document.createElement('tr');
          for (const text of r) tr.appendChild(document.createElement('td')).textContent = text;
          return tr;
        }),
      );
    }
  }

  private drawPressure(): void {
    const cv = $<HTMLCanvasElement>('pressure');
    const g = cv.getContext('2d')!;
    const cx = cv.width / 2;
    const cy = cv.height / 2;
    const R = cx - 8;
    const max = 6;
    const angle = (v: number) => Math.PI * 0.75 + (Math.min(max, Math.max(0, v)) / max) * Math.PI * 1.5;
    g.clearRect(0, 0, cv.width, cv.height);
    g.lineWidth = 2;
    g.strokeStyle = '#8b949e';
    g.beginPath();
    g.arc(cx, cy, R, angle(0), angle(max));
    g.stroke();
    g.fillStyle = '#c9d1d9';
    g.font = '11px system-ui';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (let v = 0; v <= max; v++) {
      const a = angle(v);
      g.strokeStyle = v === 4 ? '#f85149' : '#8b949e';
      g.lineWidth = v === 4 ? 3 : 1.5;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * (R - 8), cy + Math.sin(a) * (R - 8));
      g.lineTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      g.stroke();
      g.fillText(String(v), cx + Math.cos(a) * (R - 18), cy + Math.sin(a) * (R - 18));
    }
    const p = this.sim.boiler.gaugePressure / KGF_CM2;
    const a = angle(p);
    g.strokeStyle = '#f0f6fc';
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(cx - Math.cos(a) * 8, cy - Math.sin(a) * 8);
    g.lineTo(cx + Math.cos(a) * (R - 12), cy + Math.sin(a) * (R - 12));
    g.stroke();
    g.fillText('kgf/cm²', cx, cy + 26);
    g.font = 'bold 14px system-ui';
    g.fillText(p.toFixed(2), cx, cy + 44);
  }

  private drawGlass(): void {
    const cv = $<HTMLCanvasElement>('glass');
    const g = cv.getContext('2d')!;
    const top = 14;
    const h = cv.height - 28;
    const level = Math.min(1, Math.max(0, this.sim.boiler.glass));
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = '#1f2933';
    g.fillRect(16, top, 14, h);
    g.fillStyle = '#58a6ff';
    g.fillRect(16, top + h * (1 - level), 14, h * level);
    g.strokeStyle = '#c9d1d9';
    g.strokeRect(16, top, 14, h);
    g.beginPath();
    g.moveTo(10, top + h / 2);
    g.lineTo(36, top + h / 2);
    g.stroke();
    g.fillStyle = '#c9d1d9';
    g.font = '10px system-ui';
    g.textAlign = 'center';
    g.fillText('水位', cv.width / 2, 10);
    g.fillText((this.sim.boiler.glass * 100).toFixed(0) + '%', cv.width / 2, cv.height - 3);
  }

  private drawIndicator(): void {
    const cv = $<HTMLCanvasElement>('indicator');
    const g = cv.getContext('2d')!;
    const e = this.sim.engine;
    const vMax = e.clearance + e.pistonArea * this.sim.params.engine.stroke;
    const x0 = 30;
    const y0 = cv.height - 18;
    const w = cv.width - x0 - 8;
    const h = y0 - 8;
    const pMax = 5;
    const X = (V: number) => x0 + (V / vMax) * w;
    const Y = (P: number) => y0 - (Math.max(-0.3, (P - P_ATM) / KGF_CM2) / pMax) * h;
    g.clearRect(0, 0, cv.width, cv.height);
    g.strokeStyle = '#30363d';
    g.fillStyle = '#8b949e';
    g.font = '10px system-ui';
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.lineWidth = 1;
    g.setLineDash([]);
    for (let p = 0; p <= pMax; p++) {
      g.beginPath();
      g.moveTo(x0, Y(P_ATM + p * KGF_CM2));
      g.lineTo(x0 + w, Y(P_ATM + p * KGF_CM2));
      g.stroke();
      g.fillText(String(p), x0 - 4, Y(P_ATM + p * KGF_CM2));
    }
    g.textAlign = 'center';
    g.fillText('气缸容积 →', x0 + w / 2, cv.height - 7);
    g.strokeStyle = '#f0883e';
    g.beginPath();
    g.moveTo(x0, Y(this.sim.boiler.P));
    g.lineTo(x0 + w, Y(this.sim.boiler.P));
    g.stroke();
    g.lineWidth = 1.6;
    for (const end of [0, 1]) {
      g.strokeStyle = end === 0 ? '#58a6ff' : '#3fb950';
      g.setLineDash(end === 0 ? [] : [4, 3]);
      g.beginPath();
      const P = e.indP[end];
      const V = e.indV[end];
      for (let i = 0; i <= P.length; i++) {
        const k = i % P.length;
        if (V[k] === 0) continue;
        if (i === 0) g.moveTo(X(V[k]), Y(P[k]));
        else g.lineTo(X(V[k]), Y(P[k]));
      }
      g.stroke();
    }
    g.setLineDash([]);
  }

  /** Longitudinal section through the left cylinder and its slide valve. */
  private drawSection(): void {
    const cv = $<HTMLCanvasElement>('section');
    const g = cv.getContext('2d')!;
    const sim = this.sim;
    const p = sim.params.engine;
    const k = 7500;
    const cx = cv.width / 2 + 12;
    const cy = 112;
    const X = (m: number) => cx + m * k;
    const Y = (m: number) => cy - m * k;
    const rect = (x0: number, y0: number, x1: number, y1: number) => g.fillRect(X(x0), Y(y1), (x1 - x0) * k, (y1 - y0) * k);

    const pose = sim.gear.solve(sim.phi, sim.controls.reverser);
    const xp = pose.piston;
    const xv = pose.valve;
    const r = p.stroke / 2;
    const bore = p.bore / 2;
    const pt = 0.0025;
    const half = r + pt + 0.002;
    const face = bore + 0.005;
    const portIn = 0.002;
    const portOut = portIn + p.portWidth;
    const P = sim.engine.P;
    const exhaust = pressureCss(P_ATM);
    portOpenings(p, xv, this.open);

    g.clearRect(0, 0, cv.width, cv.height);
    // cylinder block
    g.fillStyle = '#3d444d';
    rect(-half - 0.002, -bore - 0.002, half + 0.002, face);
    // steam spaces
    g.fillStyle = pressureCss(P[0]);
    rect(xp + pt, -bore, half, bore);
    g.fillStyle = pressureCss(P[1]);
    rect(-half, -bore, xp - pt, bore);
    // passages from the port face to the cylinder ends
    for (const s of [1, -1]) {
      g.fillStyle = pressureCss(P[s === 1 ? 0 : 1]);
      g.beginPath();
      g.moveTo(X(s * portIn), Y(face));
      g.lineTo(X(s * portOut), Y(face));
      g.lineTo(X(s * half), Y(bore + 0.0015));
      g.lineTo(X(s * half), Y(bore));
      g.lineTo(X(s * (half - p.portWidth)), Y(bore));
      g.closePath();
      g.fill();
    }
    g.fillStyle = exhaust;
    rect(-0.0008, bore + 0.002, 0.0008, face);
    // piston and rod
    g.fillStyle = '#c9d1d9';
    rect(xp - pt, -bore, xp + pt, bore);
    rect(-half - 0.012, -0.001, xp - pt, 0.001);
    // steam chest and slide valve
    g.fillStyle = pressureCss(sim.engine.chestP);
    rect(-0.013, face, 0.013, face + 0.007);
    const vOut = portOut + p.steamLap;
    const vIn = portIn - p.exhaustLap;
    g.fillStyle = '#c9a646';
    rect(xv - vOut, face, xv + vOut, face + 0.0038);
    g.fillStyle = exhaust;
    rect(xv - vIn, face, xv + vIn, face + 0.002);
    g.fillStyle = '#c9d1d9';
    rect(-0.022, face + 0.0015, xv - vOut, face + 0.0023);

    g.fillStyle = '#c9d1d9';
    g.font = '10px system-ui';
    g.textAlign = 'center';
    g.fillText('后', X(-half) + 8, Y(-bore) + 14);
    g.fillText('前', X(half) - 8, Y(-bore) + 14);
    const o = this.open;
    const mm = (x: number) => (x * 1e3).toFixed(1);
    g.textAlign = 'left';
    g.fillText(`进汽开度 前 ${mm(o.admFront)} / 后 ${mm(o.admBack)} mm`, 6, 12);
    g.fillText(`排汽开度 前 ${mm(o.exhFront)} / 后 ${mm(o.exhBack)} mm`, 6, 25);
  }
}
