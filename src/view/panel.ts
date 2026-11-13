import { getLocale, onLocaleChange, setLocale, t } from '../i18n';
import type { LocoSim, Mode, Warning } from '../sim/loco';
import { KGF_CM2, P_ATM } from '../sim/steam';
import { cssHex, prepareCanvas } from './colors';
import { Diagrams, type DockTab } from './diagrams';
import { FLOW_COLORS, FLOW_LEGEND } from './flow';
import type { ViewMode } from './locoModel';
import { PhaseBoard } from './phaseBoard';
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
const DOCK_HEIGHT = 312;
/** width taken by each side panel on the wide layout, including its margin */
const SIDE_PANEL = 352;
/** Phones, tablets and small windows: keep in step with the media query in style.css. */
const COMPACT = '(max-width: 1200px), (max-height: 600px)';

export class Panel {
  private readonly readouts: [string, () => string][];
  private readonly cells: HTMLElement[] = [];
  private readonly diagrams: Diagrams;
  private readonly phaseBoard: PhaseBoard;
  private eventsFor = NaN;
  private frame = 0;
  private toastTimer = 0;
  private toastSource = '';

  constructor(
    private readonly sim: LocoSim,
    view: LocoView,
    state: AppState,
  ) {
    const locale = $<HTMLSelectElement>('locale');
    locale.value = getLocale();
    locale.addEventListener('change', () => setLocale(locale.value));
    // Translated settings can occupy another header row on desktop.
    new ResizeObserver(() => {
      document.documentElement.style.setProperty('--top-height', `${$('top').getBoundingClientRect().height}px`);
    }).observe($('top'));
    const c = sim.controls;
    for (const key of SLIDERS) {
      const input = $<HTMLInputElement>(key);
      input.addEventListener('input', () => {
        c[key] = Number(input.value) / 100;
        $(key + 'Out').textContent = input.value + '%';
        if (key === 'reverser') this.phaseBoard.update();
      });
    }
    for (const key of TOGGLES) {
      const input = $<HTMLInputElement>(key);
      input.addEventListener('change', () => (c[key] = input.checked));
    }
    $('ignite').addEventListener('click', () => {
      const result = sim.ignite();
      if (result === 'valveClosed') this.toast('点不着：燃料阀还关着。先把“燃料阀”开到约 50%，再点火。');
      else if (result === 'noFuel') this.toast('点不着：酒精箱是空的，先点“加燃料”。');
      else if (!c.fan && c.blower === 0) this.toast('已点着。没有抽风时火很弱，冷态请勾选“烟囱通风机”。');
      else this.toast('已点着。');
    });
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
    const timeScale = $<HTMLSelectElement>('timeScale');
    const paused = $<HTMLInputElement>('paused');
    const trainMass = $<HTMLInputElement>('trainMass');
    const grade = $<HTMLInputElement>('grade');
    // also run once at startup: a browser refresh restores form values without firing events
    const applyRun = () => {
      if (sim.mode !== mode.value) sim.v = 0;
      sim.mode = mode.value as Mode;
      state.timeScale = Number(timeScale.value);
      state.paused = paused.checked;
      sim.params.track.trainMass = Math.max(0, Number(trainMass.value) || 0);
      sim.params.track.gradePermil = Number(grade.value) || 0;
    };
    for (const el of [mode, timeScale, paused, trainMass, grade]) el.addEventListener('change', applyRun);
    applyRun();
    this.phaseBoard = new PhaseBoard(sim, state, $('phaseBoard'));
    paused.addEventListener('change', () => this.phaseBoard.update());

    // 3D view options
    const viewMode = $<HTMLSelectElement>('viewMode');
    const flow = $<HTMLInputElement>('flow');
    const labels = $<HTMLInputElement>('labels');
    const legend = $('legend');
    const legendLabels: [HTMLElement, string][] = [];
    for (const [key, text] of FLOW_LEGEND) {
      const item = legend.appendChild(document.createElement('button'));
      item.textContent = t(text);
      legendLabels.push([item, text]);
      item.style.setProperty('--c', cssHex(FLOW_COLORS[key]));
      item.setAttribute('aria-pressed', 'true');
      item.addEventListener('click', () => {
        const on = !item.classList.toggle('off');
        item.setAttribute('aria-pressed', String(on));
        view.setFlowKind(key, on);
      });
    }
    const tip = legend.appendChild(document.createElement('span'));
    tip.className = 'tip';
    tip.textContent = t('点按可单独隐藏或显示');
    const applyView = () => {
      view.setView(viewMode.value as ViewMode, flow.checked, labels.checked);
      legend.hidden = !flow.checked;
    };
    for (const el of [viewMode, flow, labels]) el.addEventListener('change', applyView);
    applyView();
    const explode = $<HTMLInputElement>('explode');
    const applyExplode = () => view.setExplode(Number(explode.value) / 100);
    explode.addEventListener('input', applyExplode);
    applyExplode();

    // diagram dock
    this.diagrams = new Diagrams(sim, $<HTMLCanvasElement>('diagram'));
    const dock = $('dock');
    const tabs = [...dock.querySelectorAll<HTMLButtonElement>('button[data-tab]')];
    const compact = window.matchMedia(COMPACT);
    const applyDock = () => {
      const collapsed = dock.classList.contains('collapsed') && !compact.matches;
      for (const t of tabs) t.classList.toggle('on', !collapsed && t.dataset.tab === this.diagrams.tab);
      $('dockToggle').textContent = t(collapsed ? '展开' : '收起');
      $('dockToggle').setAttribute('aria-expanded', String(!collapsed));
      // in the compact layout the view has its own area, nothing covers it
      view.setBottomInset(collapsed || compact.matches ? 0 : DOCK_HEIGHT);
      view.setSideInset(compact.matches ? 0 : SIDE_PANEL);
    };
    for (const t of tabs) {
      t.addEventListener('click', () => {
        this.diagrams.tab = t.dataset.tab as DockTab;
        dock.classList.remove('collapsed');
        applyDock();
      });
    }
    $('dockToggle').addEventListener('click', () => {
      dock.classList.toggle('collapsed');
      applyDock();
    });
    window.addEventListener('resize', applyDock);
    compact.addEventListener('change', applyDock);
    applyDock();

    // compact layout: one panel at a time in a sheet; tapping the current tab folds the sheet away
    const body = document.body;
    const sheetTabs = [...$('mtabs').querySelectorAll<HTMLButtonElement>('button[data-sheet]')];
    const applySheet = () => {
      const open = !body.classList.contains('sheet-closed');
      for (const t of sheetTabs) t.classList.toggle('on', open && t.dataset.sheet === body.dataset.sheet);
      $('sheetToggle').textContent = open ? '▾' : '▴';
      $('sheetToggle').setAttribute('aria-expanded', String(open));
    };
    for (const t of sheetTabs) {
      t.addEventListener('click', () => {
        const same = body.dataset.sheet === t.dataset.sheet && !body.classList.contains('sheet-closed');
        body.dataset.sheet = t.dataset.sheet;
        body.classList.toggle('sheet-closed', same);
        applySheet();
      });
    }
    $('sheetToggle').addEventListener('click', () => {
      body.classList.toggle('sheet-closed');
      applySheet();
    });
    body.dataset.sheet = 'controls';
    applySheet();

    $('openPhase').addEventListener('click', () => {
      body.dataset.sheet = 'gauges';
      body.classList.remove('sheet-closed');
      applySheet();
      $('gauges').scrollTop = 0;
      $('phaseBoard').focus({ preventScroll: true });
      this.phaseBoard.update();
    });

    const e = sim.engine;
    const b = sim.boiler;
    const kgf = (P: number) => ((P - P_ATM) / KGF_CM2).toFixed(2) + ' kgf/cm²';
    this.readouts = [
      ['锅炉压力', () => (b.gaugePressure / KGF_CM2).toFixed(2) + ' kgf/cm²'],
      ['汽室压力', () => kgf(e.chestP)],
      ['锅炉温度', () => (b.T - 273.15).toFixed(0) + ' °C'],
      ['水位（玻璃管）', () => (Math.min(1.2, Math.max(-0.2, b.glass)) * 100).toFixed(0) + ' %'],
      ['速度', () => t('{speed} m/s（实车 {scaleSpeed} km/h）', { speed: sim.v.toFixed(2), scaleSpeed: sim.speedScaleKmh.toFixed(0) })],
      ['动轮转速', () => (sim.omega / (2 * Math.PI)).toFixed(1) + ' r/s'],
      ['牵引力', () => sim.tractiveForce.toFixed(1) + ' N'],
      ['指示功率', () => sim.indicatedPower.toFixed(1) + ' W'],
      ['耗汽量', () => (sim.steamFlow * 1e3).toFixed(3) + ' g/s'],
      ['给水量', () => (sim.feedFlow * 1e3).toFixed(3) + ' g/s'],
      ['火力', () => sim.lit ? t('{percent} %（{power} W）', { percent: (sim.fireGain * 100).toFixed(0), power: sim.firePower.toFixed(0) }) : t('未点火')],
      ['过热度', () => sim.superheat.toFixed(0) + ' K'],
      ['缸壁温度 左 / 右', () => `${(e.wallT[0] - 273.15).toFixed(0)} / ${(e.wallT[1] - 273.15).toFixed(0)} °C`],
      ['燃料', () => (sim.fuel * 1e6).toFixed(0) + ' mL'],
      ['水柜', () => (sim.tenderWater * 1e6).toFixed(0) + ' mL'],
      ['润滑油', () => (sim.oil * 100).toFixed(0) + ' %'],
    ];
    const table = $('readouts');
    const readoutLabels: HTMLElement[] = [];
    for (const [label] of this.readouts) {
      const row = table.appendChild(document.createElement('tr'));
      const cell = row.appendChild(document.createElement('td'));
      cell.textContent = t(label);
      readoutLabels.push(cell);
      this.cells.push(row.appendChild(document.createElement('td')));
    }
    this.syncControls();
    onLocaleChange(() => {
      locale.value = getLocale();
      for (const [el, source] of legendLabels) el.textContent = t(source);
      tip.textContent = t('点按可单独隐藏或显示');
      readoutLabels.forEach((el, i) => { el.textContent = t(this.readouts[i][0]); });
      if (this.toastSource) $('toast').textContent = t(this.toastSource);
      applyDock();
      this.eventsFor = NaN;
      this.frame = 0;
      this.update(0); // Refresh even while paused or requestAnimationFrame is throttled.
    });
  }

  private toast(text: string): void {
    const el = $('toast');
    this.toastSource = text;
    el.textContent = t(text);
    el.hidden = false;
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (el.hidden = true), 4500);
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

  /** What the manual's procedure asks for next, given the current state. */
  private nextStep(): string {
    const s = this.sim;
    const c = s.controls;
    const p = s.boiler.gaugePressure / KGF_CM2;
    const moving = Math.abs(s.omega) > 0.5;
    if (s.fuel <= 0) return t('燃料耗尽：点“加燃料”，再重新点火。');
    if (!s.lit) {
      if (p > 1) return t('火已熄灭：燃料阀开到约 50% 后点“点火”；也可以靠余压继续行驶。');
      if (c.fuelValve <= 0) return t('第 1 步：把“燃料阀”开到约 50%。');
      if (!c.fan) return t('第 2 步：勾选“烟囱通风机”（冷态没有蒸汽，靠它抽风）。');
      return t('第 3 步：点“点火”。');
    }
    if (s.boiler.glass < 0.15) return t('水位过低：关小“旁通阀”让轴泵给水，或点“手摇泵”。');
    if (p < 1.5) return t(c.fan || c.blower > 0 ? '升压中…到 1.5–2 kgf/cm² 后改用通风阀。嫌慢可把时间倍率调到 20×。' : '火力很弱：冷态请勾选“烟囱通风机”抽风。');
    if (c.fan) return t('第 4 步：取消“烟囱通风机”，把“通风阀”开到约 30%，继续升压到 4 kgf/cm²。');
    if (!moving) {
      if (p < 3) return t('继续升压到 3–4 kgf/cm²（通风阀约 30%）。');
      if (c.regulator <= 0) return t('第 5 步：勾选“气缸排水阀”，再慢慢打开“加减阀”（约 25–30%）起步。');
      const wall = Math.min(s.engine.wallT[0], s.engine.wallT[1]) - 273.15;
      if (wall < 95) return t('暖缸中：蒸汽正在冷气缸里凝结（缸壁 {temperature} °C），热起来后才有力起步，约需半分钟；排水阀保持打开。', { temperature: wall.toFixed(0) });
      return t('加减阀再开大一点；若停在死点附近，可点“推 →”。');
    }
    if (c.drains) return t('第 6 步：凝水排净后取消“气缸排水阀”。');
    return t('运行中：加减阀控制速度；回动手柄拉向中立可省汽；调“旁通阀”把水位保持在 50% 左右。');
  }

  update(dt: number): void {
    const sim = this.sim;
    this.phaseBoard.update();
    this.drawPressure();
    this.drawGlass();
    this.drawIndicator();
    this.diagrams.update(dt);
    if (this.frame++ % 6 !== 0) return;

    this.readouts.forEach(([, value], i) => (this.cells[i].textContent = value()));
    $('hint').textContent = this.nextStep();
    const seconds = Math.floor(sim.time);
    $('clock').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')} · ${sim.distance.toFixed(1)} m`;
    $('warnings').replaceChildren(
      ...sim.warnings().map((w) => {
        const s = document.createElement('span');
        s.textContent = t(WARNING_TEXT[w]);
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
          for (const text of r) tr.appendChild(document.createElement('td')).textContent = t(text);
          return tr;
        }),
      );
    }
  }

  private drawPressure(): void {
    const c = prepareCanvas($<HTMLCanvasElement>('pressure'));
    if (!c) return;
    const { g, w, h } = c;
    const cx = w / 2;
    const cy = h / 2;
    const R = cx - 8;
    const max = 6;
    const angle = (v: number) => Math.PI * 0.75 + (Math.min(max, Math.max(0, v)) / max) * Math.PI * 1.5;
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
    const c = prepareCanvas($<HTMLCanvasElement>('glass'));
    if (!c) return;
    const { g, w, h } = c;
    const top = 14;
    const hh = h - 28;
    const level = Math.min(1, Math.max(0, this.sim.boiler.glass));
    g.fillStyle = '#1f2933';
    g.fillRect(16, top, 14, hh);
    g.fillStyle = '#58a6ff';
    g.fillRect(16, top + hh * (1 - level), 14, hh * level);
    g.strokeStyle = '#c9d1d9';
    g.lineWidth = 1;
    g.strokeRect(16, top, 14, hh);
    g.beginPath();
    g.moveTo(10, top + hh / 2);
    g.lineTo(36, top + hh / 2);
    g.stroke();
    g.fillStyle = '#c9d1d9';
    g.font = '10px system-ui';
    g.textAlign = 'center';
    g.fillText(t('水位'), w / 2, 10, w - 4);
    g.fillText((this.sim.boiler.glass * 100).toFixed(0) + '%', w / 2, h - 3);
  }

  /** Right-hand cylinder, matching the diagrams in the dock. */
  private drawIndicator(): void {
    const c = prepareCanvas($<HTMLCanvasElement>('indicator'));
    if (!c) return;
    const { g, w: cw, h: ch } = c;
    const e = this.sim.engine;
    const vMax = e.clearance + e.pistonArea * this.sim.params.engine.stroke;
    const x0 = 30;
    const y0 = ch - 18;
    const w = cw - x0 - 8;
    const h = y0 - 8;
    const pMax = 5;
    const X = (V: number) => x0 + (V / vMax) * w;
    const Y = (P: number) => y0 - (Math.max(-0.3, (P - P_ATM) / KGF_CM2) / pMax) * h;
    g.strokeStyle = '#30363d';
    g.fillStyle = '#8b949e';
    g.font = '10px system-ui';
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.lineWidth = 1;
    for (let p = 0; p <= pMax; p++) {
      g.beginPath();
      g.moveTo(x0, Y(P_ATM + p * KGF_CM2));
      g.lineTo(x0 + w, Y(P_ATM + p * KGF_CM2));
      g.stroke();
      g.fillText(String(p), x0 - 4, Y(P_ATM + p * KGF_CM2));
    }
    g.textAlign = 'center';
    g.fillText(t('气缸容积 →'), x0 + w / 2, ch - 7);
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
      const P = e.indP[2 + end];
      const V = e.indV[2 + end];
      let started = false;
      for (let i = 0; i <= P.length; i++) {
        const k = i % P.length;
        if (V[k] === 0) continue;
        if (started) g.lineTo(X(V[k]), Y(P[k]));
        else g.moveTo(X(V[k]), Y(P[k]));
        started = true;
      }
      g.stroke();
    }
    g.setLineDash([]);
  }
}
