import { t } from '../i18n';
import { portOpenings, type PortOpenings } from '../sim/engine';
import type { LocoSim } from '../sim/loco';
import { sidePhase } from '../sim/runningGear';
import { KGF_CM2, P_ATM } from '../sim/steam';
import type { Vec2 } from '../sim/valveGear';
import { PART_COLORS, PART_LABELS, cssHex, prepareCanvas, pressureCss } from './colors';
import { FLOW_COLORS } from './flow';
import { LAYOUT } from './locoModel';

export type DockTab = 'section' | 'gear' | 'flow';
type G = CanvasRenderingContext2D;

/** Diagrams show the right-hand side seen from outside, so the front of the engine is on the right. */
const SIDE = 1;
const PT = 0.0025;
const WALL = 0.002;
const TEXT = '#e6edf3';
const DIM = '#8b949e';
const FONT = '11px system-ui, "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';
const PHASES = [
  ['进汽', '#f85149'],
  ['膨胀', '#f0883e'],
  ['排汽', '#58a6ff'],
  ['压缩', '#bc8cff'],
] as const;
const RING_N = 180;

function line(g: G, a: Vec2, b: Vec2): void {
  g.beginPath();
  g.moveTo(a.x, a.y);
  g.lineTo(b.x, b.y);
  g.stroke();
}

function arrow(g: G, x0: number, y0: number, x1: number, y1: number, head = 5): void {
  const a = Math.atan2(y1 - y0, x1 - x0);
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
  g.beginPath();
  g.moveTo(x1, y1);
  g.lineTo(x1 - head * Math.cos(a - 0.5), y1 - head * Math.sin(a - 0.5));
  g.lineTo(x1 - head * Math.cos(a + 0.5), y1 - head * Math.sin(a + 0.5));
  g.closePath();
  g.fill();
}

/** Wrap prose at words, falling back to characters for unspaced CJK text. */
function wrappedText(g: G, text: string, x: number, y: number, width: number, lineHeight = 14): void {
  let line = '';
  for (const word of text.split(/(\s+)/)) {
    if (line && g.measureText(line + word).width > width) {
      g.fillText(line.trimEnd(), x, y);
      line = '';
      y += lineHeight;
    }
    if (g.measureText(word).width > width) {
      for (const char of word) {
        if (g.measureText(line + char).width > width) {
          g.fillText(line, x, y);
          line = '';
          y += lineHeight;
        }
        line += char;
      }
    } else line += line ? word : word.trimStart();
  }
  if (line) g.fillText(line.trimEnd(), x, y);
}

export class Diagrams {
  tab: DockTab = 'section';
  private readonly open: PortOpenings = { admFront: 0, admBack: 0, exhFront: 0, exhBack: 0 };
  private readonly ring = [new Uint8Array(RING_N), new Uint8Array(RING_N)];
  private ringKey = '';
  private traces: Vec2[][] = [];
  private traceKey = NaN;
  private readonly dash = new Map<string, number>();
  private dt = 0;

  constructor(
    private readonly sim: LocoSim,
    private readonly canvas: HTMLCanvasElement,
  ) {}

  update(dt: number): void {
    const c = prepareCanvas(this.canvas);
    if (!c) return;
    this.dt = dt;
    // keep the valve table current while the simulation is paused
    this.sim.gear.setReverser(this.sim.controls.reverser);
    c.g.font = FONT;
    c.g.lineCap = 'round';
    c.g.lineJoin = 'round';
    if (this.tab === 'section') this.drawSection(c.g, c.w, c.h);
    else if (this.tab === 'gear') this.drawGear(c.g, c.w, c.h);
    else this.drawFlow(c.g, c.w, c.h);
  }

  private get phi(): number {
    return sidePhase(this.sim.phi, SIDE);
  }

  private get direction(): number {
    const s = this.sim;
    return Math.abs(s.omega) > 0.05 ? Math.sign(s.omega) : s.controls.reverser < 0 ? -1 : 1;
  }

  /** 0 admission, 1 expansion, 2 exhaust, 3 compression for [front, back] at crank angle a. */
  private phases(a: number, dir: number): [number, number] {
    const o = portOpenings(this.sim.params.engine, this.sim.gear.valveAt(a), this.open);
    const dx = this.sim.gear.dPiston(a) * dir;
    return [o.admFront > 0 ? 0 : o.exhFront > 0 ? 2 : dx < 0 ? 1 : 3, o.admBack > 0 ? 0 : o.exhBack > 0 ? 2 : dx > 0 ? 1 : 3];
  }

  // ---------------------------------------------------------------- cylinder and slide valve

  private drawSection(g: G, W: number, H: number): void {
    const sim = this.sim;
    const p = sim.params.engine;
    const pose = sim.gear.solve(this.phi, sim.controls.reverser);
    const xp = pose.piston;
    const xv = pose.valve;
    const r = p.stroke / 2;
    const bore = p.bore / 2;
    const half = r + PT + 0.002;
    const face = bore + 0.0055;
    const chestTop = face + 0.0075;
    // port layout of the drawing; the simulation itself only uses the laps and the port width
    const pIn = 0.0034;
    const pOut = pIn + p.portWidth;
    const exH = 0.0018;
    const vOut = pOut + p.steamLap;
    const vIn = pIn - p.exhaustLap;
    const chestHalf = vOut + 0.0042;
    const rodOut = 0.011;

    const info = W > 740 ? 360 : 0;
    const secW = W - info;
    const spanX = 2 * (half + WALL) + rodOut;
    const spanY = chestTop + bore + 2 * WALL;
    const k = Math.min((H - 62) / spanY, (secW - 24) / spanX);
    const cx = (secW - spanX * k) / 2 + (rodOut + half + WALL) * k;
    const cy = 30 + (chestTop + WALL) * k;
    const X = (m: number) => cx + m * k;
    const Y = (m: number) => cy - m * k;
    const rect = (x0: number, y0: number, x1: number, y1: number) => g.fillRect(X(x0), Y(y1), (x1 - x0) * k, (y1 - y0) * k);

    const iF = SIDE * 2;
    const iB = SIDE * 2 + 1;
    const P = sim.engine.P;
    const exhaust = pressureCss(P_ATM);
    const o = portOpenings(p, xv, this.open);

    // block and chest walls
    g.fillStyle = '#3a4048';
    rect(-half - WALL, -bore - WALL, half + WALL, face);
    rect(-chestHalf - WALL, face, chestHalf + WALL, chestTop + WALL);
    // steam spaces
    g.fillStyle = pressureCss(sim.engine.chestP);
    rect(-chestHalf, face, chestHalf, chestTop);
    g.fillStyle = pressureCss(P[iF]);
    rect(xp + PT, -bore, half, bore);
    g.fillStyle = pressureCss(P[iB]);
    rect(-half, -bore, xp - PT, bore);
    // Drawing 9 crosses the passages in separate planes; the outline marks a crossing, not a junction.
    for (const s of [1, -1]) {
      g.fillStyle = pressureCss(P[s === 1 ? iB : iF]);
      g.strokeStyle = '#3a4048';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(X(s * pIn), Y(face));
      g.lineTo(X(s * pOut), Y(face));
      g.lineTo(X(s * pOut), Y(face - 0.0008));
      g.lineTo(X(-s * half), Y(bore + 0.0018));
      g.lineTo(X(-s * half), Y(bore));
      g.lineTo(X(-s * (half - 0.0022)), Y(bore));
      g.lineTo(X(s * pIn), Y(face - 0.0024));
      g.closePath();
      g.fill();
      g.stroke();
    }
    // exhaust port leading out of the page to the blast pipe
    g.fillStyle = exhaust;
    rect(-exH, face - 0.0042, exH, face);
    g.strokeStyle = '#0d1117';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(X(0), Y(face - 0.0025), 0.0011 * k, 0, 2 * Math.PI);
    g.stroke();
    // piston and rod
    g.fillStyle = '#c9d1d9';
    rect(xp - PT, -bore, xp + PT, bore);
    rect(-half - WALL - rodOut, -0.001, xp - PT, 0.001);
    g.strokeStyle = '#57606a';
    g.lineWidth = 1;
    for (const d of [-0.0009, 0.0009]) line(g, { x: X(xp + d), y: Y(bore) }, { x: X(xp + d), y: Y(-bore) });
    // slide valve: D-shaped, its cavity joins a steam port to the exhaust port
    g.fillStyle = '#c9a646';
    rect(xv - vOut, face, xv + vOut, face + 0.0046);
    g.fillStyle = exhaust;
    rect(xv - vIn, face, xv + vIn, face + 0.0027);
    g.fillStyle = '#c9d1d9';
    rect(-chestHalf - WALL - 0.008, face + 0.0033, xv - vOut, face + 0.0041);

    // flow arrows through whichever ports are open
    g.strokeStyle = g.fillStyle = '#ffffff';
    g.lineWidth = 2;
    const down = (x: number) => arrow(g, X(x), Y(face + 0.0042), X(x), Y(face - 0.0026));
    const up = (x: number) => {
      arrow(g, X(x), Y(face - 0.0028), X(x), Y(face + 0.0018));
      arrow(g, X(0), Y(face + 0.002), X(0), Y(face - 0.0034));
    };
    if (o.admBack > 0) down((Math.max(pIn, xv + vOut) + pOut) / 2);
    if (o.admFront > 0) down((-pOut + Math.min(-pIn, xv - vOut)) / 2);
    if (o.exhBack > 0) up((pIn + Math.min(pOut, xv + vIn)) / 2);
    if (o.exhFront > 0) up((Math.max(-pOut, xv - vIn) - pIn) / 2);

    // labels
    const kgf = (pa: number) => ((pa - P_ATM) / KGF_CM2).toFixed(2);
    const [phF, phB] = this.phases(this.phi, this.direction);
    g.textBaseline = 'alphabetic';
    g.textAlign = 'center';
    g.fillStyle = TEXT;
    g.fillText(t('汽室 {pressure} kgf/cm²', { pressure: kgf(sim.engine.chestP) }), X(0), Y(chestTop + WALL) - 5);
    g.fillStyle = '#1f2328';
    g.fillText(t('滑阀'), X(xv), Y(face + 0.0031), vOut * 2 * k - 4);
    const below = Y(-bore - WALL) + 15;
    for (const [x, name, pa, ph] of [
      [half / 2, '前端', P[iF], phF],
      [-half / 2, '后端', P[iB], phB],
    ] as const) {
      g.fillStyle = TEXT;
      g.fillText(`${t(name)} ${kgf(pa)} kgf/cm²`, X(x), below, half * k - 4);
      g.fillStyle = PHASES[ph][1];
      g.fillText(t(PHASES[ph][0]), X(x), below + 14);
    }
    g.fillStyle = DIM;
    g.textAlign = 'left';
    g.fillText(t('活塞杆 → 十字头'), X(-half - WALL - rodOut), Y(0.001) - 5, rodOut * k + 40);
    g.fillText(t('← 后'), 8, below + 14);
    g.textAlign = 'right';
    g.fillText(t('前 →'), secW - 8, below + 14);
    g.textAlign = 'left';
    g.fillStyle = TEXT;
    g.fillText(t('右侧气缸与滑阀 · 交叉汽道不互通，中央排汽口通烟囱'), 8, 14, secW - 16);

    if (info) this.drawEventRing(g, secW, H, o);
  }

  private drawEventRing(g: G, x0: number, H: number, o: PortOpenings): void {
    const sim = this.sim;
    const dir = this.direction;
    const key = `${sim.controls.reverser}/${dir}`;
    if (key !== this.ringKey) {
      this.ringKey = key;
      for (let i = 0; i < RING_N; i++) {
        const [f, b] = this.phases(((i + 0.5) * 2 * Math.PI) / RING_N, dir);
        this.ring[0][i] = f;
        this.ring[1][i] = b;
      }
    }
    const R = Math.min(68, (H - 86) / 2);
    const cx = x0 + R + 24;
    const cy = 28 + R;
    g.lineCap = 'butt';
    this.ring.forEach((states, end) => {
      const rad = R - 6 - end * 15;
      g.lineWidth = 11;
      let start = 0;
      for (let i = 1; i <= RING_N; i++) {
        if (i < RING_N && states[i] === states[start]) continue;
        g.strokeStyle = PHASES[states[start]][1];
        g.beginPath();
        g.arc(cx, cy, rad, (start * 2 * Math.PI) / RING_N, (i * 2 * Math.PI) / RING_N + 0.005);
        g.stroke();
        start = i;
      }
    });
    g.lineCap = 'round';
    // crank position: on screen the wheel turns clockwise when running forward
    const a = this.phi;
    g.strokeStyle = g.fillStyle = '#ffffff';
    g.lineWidth = 2;
    line(g, { x: cx, y: cy }, { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
    g.beginPath();
    g.arc(cx + (R - 28) * 0.6 * Math.cos(a), cy + (R - 28) * 0.6 * Math.sin(a), 3, 0, 2 * Math.PI);
    g.fill();
    // dead centres, labelled outside the ring
    g.strokeStyle = g.fillStyle = DIM;
    g.lineWidth = 1.5;
    line(g, { x: cx + R + 2, y: cy }, { x: cx + R + 7, y: cy });
    line(g, { x: cx - R - 2, y: cy }, { x: cx - R - 7, y: cy });
    g.textAlign = 'left';
    g.fillText(t('前'), cx + R + 9, cy + 4);
    g.textAlign = 'right';
    g.fillText(t('后'), cx - R - 9, cy + 4);
    g.textAlign = 'left';
    g.fillStyle = TEXT;
    g.fillText(t('配气相位（外圈前端 / 内圈后端）'), x0 + 8, 14, 344);

    let lx = x0 + 8;
    const ly = cy + R + 18;
    for (const [name, color] of PHASES) {
      g.fillStyle = color;
      g.fillRect(lx, ly - 9, 10, 10);
      g.fillStyle = TEXT;
      const text = t(name);
      g.fillText(text, lx + 13, ly);
      lx += g.measureText(text).width + 24;
    }
    g.fillStyle = DIM;
    g.fillText(t('白线：曲柄位置；前 / 后：前、后死点'), x0 + 8, ly + 16, 344);

    const tx = cx + R + 26;
    const mm = (x: number) => (x * 1e3).toFixed(2);
    const deg = ((((a * 180) / Math.PI) % 360) + 360) % 360;
    const rows = [
      t('曲柄角 {angle}°', { angle: deg.toFixed(0) }),
      t('回动手柄 {percent}%', { percent: (sim.controls.reverser * 100).toFixed(0) }),
      t('进汽开度 前 {opening}', { opening: mm(o.admFront) }),
      t('　　　　 后 {opening} mm', { opening: mm(o.admBack) }),
      t('排汽开度 前 {opening}', { opening: mm(o.exhFront) }),
      t('　　　　 后 {opening} mm', { opening: mm(o.exhBack) }),
    ];
    g.fillStyle = TEXT;
    rows.forEach((t, i) => g.fillText(t, tx, 44 + i * 15));
    // pressure colour scale
    const sy = 44 + rows.length * 15 + 4;
    for (let i = 0; i < 80; i++) {
      g.fillStyle = pressureCss(P_ATM + (i / 79) * 4 * KGF_CM2);
      g.fillRect(tx + i, sy, 1.5, 8);
    }
    g.fillStyle = DIM;
    g.fillText('0', tx, sy + 20);
    g.textAlign = 'right';
    g.fillText('4 kgf/cm²', tx + 100, sy + 20);
    g.textAlign = 'left';
  }

  // ---------------------------------------------------------------- Walschaerts linkage

  private drawGear(g: G, W: number, H: number): void {
    const sim = this.sim;
    const p = sim.params;
    const gp = p.gear;
    const e = p.engine;
    const rw = p.chassis.wheelDia / 2;
    const r = e.stroke / 2;
    const bore = e.bore / 2;
    const half = r + PT + 0.002;
    const x0 = gp.conRod + gp.pistonRod;
    const vy = gp.valveSpindleY;
    const pose = sim.gear.solve(this.phi, sim.controls.reverser);

    const xmin = LAYOUT.driverX[3] - rw - 0.005;
    const xmax = x0 + half + 0.008;
    const ymin = -rw - 0.002;
    const ymax = vy + 0.013;
    const k = Math.min((W - 30) / (xmax - xmin), (H - 50) / (ymax - ymin));
    const left = (W - (xmax - xmin) * k) / 2;
    const top = 38 + (H - 50 - (ymax - ymin) * k) / 2;
    const X = (m: number) => left + (m - xmin) * k;
    const Y = (m: number) => top + (ymax - m) * k;
    const S = (v: Vec2): Vec2 => ({ x: X(v.x), y: Y(v.y) });
    const rect = (xa: number, ya: number, xb: number, yb: number) => g.fillRect(X(xa), Y(yb), (xb - xa) * k, (yb - ya) * k);
    const bar = (name: keyof typeof PART_COLORS, a: Vec2, b: Vec2, width = 4) => {
      g.strokeStyle = cssHex(PART_COLORS[name]);
      g.lineWidth = width;
      line(g, S(a), S(b));
    };
    const pin = (v: Vec2, rad = 2.5) => {
      g.fillStyle = '#0d1117';
      g.strokeStyle = '#e6edf3';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(X(v.x), Y(v.y), rad, 0, 2 * Math.PI);
      g.fill();
      g.stroke();
    };
    const tag = (name: keyof typeof PART_COLORS, v: Vec2, dx: number, dy: number, align: CanvasTextAlign = 'center') => {
      g.fillStyle = cssHex(PART_COLORS[name]);
      g.textAlign = align;
      const text = t(PART_LABELS[name]);
      const width = g.measureText(text).width;
      const x = X(v.x) + dx;
      const offset = align === 'center' ? width / 2 : align === 'right' ? width : 0;
      g.fillText(text, Math.max(offset + 4, Math.min(W - width + offset - 4, x)), Y(v.y) + dy);
    };
    const mid = (a: Vec2, b: Vec2): Vec2 => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

    // rail and wheels
    g.strokeStyle = '#6e7681';
    g.lineWidth = 2;
    line(g, { x: X(xmin), y: Y(-rw) }, { x: X(xmax), y: Y(-rw) });
    for (const dx of LAYOUT.driverX) {
      g.globalAlpha = dx === 0 ? 1 : 0.35;
      g.fillStyle = '#161b22';
      g.strokeStyle = '#8b949e';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(X(dx), Y(0), rw * k, 0, 2 * Math.PI);
      g.fill();
      g.stroke();
      line(g, S({ x: dx, y: 0 }), S({ x: dx + pose.crankPin.x, y: pose.crankPin.y }));
    }
    g.globalAlpha = 0.6;
    bar('coupling', { x: LAYOUT.driverX[3] + pose.crankPin.x, y: pose.crankPin.y }, { x: LAYOUT.driverX[0] + pose.crankPin.x, y: pose.crankPin.y }, 5);
    g.globalAlpha = 1;

    // paths traced by the moving pins over one revolution
    if (this.traceKey !== sim.controls.reverser) {
      this.traceKey = sim.controls.reverser;
      this.traces = [[], [], [], []];
      for (let i = 0; i <= 72; i++) {
        const q = sim.gear.solve((i * Math.PI) / 36, this.traceKey);
        this.traces[0].push(q.eccPin);
        this.traces[1].push(q.linkTail);
        this.traces[2].push(q.leverTop);
        this.traces[3].push(q.leverBottom);
      }
    }
    g.strokeStyle = 'rgba(230,237,243,0.22)';
    g.lineWidth = 1;
    for (const tr of this.traces) {
      g.beginPath();
      tr.forEach((v, i) => (i ? g.lineTo(X(v.x), Y(v.y)) : g.moveTo(X(v.x), Y(v.y))));
      g.stroke();
    }

    // cylinder, piston, valve chest, slide bars
    const P = sim.engine.P;
    g.fillStyle = '#3a4048';
    rect(x0 - half - WALL, -bore - WALL, x0 + half + WALL, bore + WALL);
    rect(x0 - 0.0155, vy - 0.0045, x0 + 0.0155, vy + 0.0045);
    g.fillStyle = pressureCss(sim.engine.chestP);
    rect(x0 - 0.014, vy - 0.003, x0 + 0.014, vy + 0.003);
    g.fillStyle = pressureCss(P[SIDE * 2]);
    rect(x0 + pose.piston + PT, -bore, x0 + half, bore);
    g.fillStyle = pressureCss(P[SIDE * 2 + 1]);
    rect(x0 - half, -bore, x0 + pose.piston - PT, bore);
    g.fillStyle = '#c9d1d9';
    rect(x0 + pose.piston - PT, -bore, x0 + pose.piston + PT, bore);
    g.strokeStyle = '#6e7681';
    g.lineWidth = 2;
    for (const y of [0.0052, -0.0052]) line(g, S({ x: gp.conRod - r - 0.006, y }), S({ x: gp.conRod + r + 0.006, y }));

    // the linkage
    const valveL = { x: x0 + pose.valve - 0.0062, y: vy };
    bar('mainRod', pose.crankPin, pose.crosshead, 5);
    bar('crosshead', pose.crosshead, { x: x0 + pose.piston - PT, y: 0 }, 3);
    bar('crosshead', pose.crosshead, pose.dropPin, 3);
    g.fillStyle = cssHex(PART_COLORS.crosshead);
    rect(pose.crosshead.x - 0.004, -0.0045, pose.crosshead.x + 0.004, 0.0045);
    bar('returnCrank', pose.crankPin, pose.eccPin);
    bar('eccRod', pose.eccPin, pose.linkTail, 3);
    const kk = (gp.dieMax + 0.002) / gp.linkTail;
    const linkTop = { x: pose.linkPivot.x + (pose.linkPivot.x - pose.linkTail.x) * kk, y: pose.linkPivot.y + (pose.linkPivot.y - pose.linkTail.y) * kk };
    bar('link', pose.linkTail, linkTop, 6);
    bar('radiusRod', pose.dieBlock, pose.leverTop, 3);
    bar('lever', pose.leverTop, pose.leverBottom, 3);
    bar('union', pose.leverBottom, pose.dropPin, 3);
    bar('valve', pose.leverMid, valveL, 3);
    g.fillStyle = cssHex(PART_COLORS.valve);
    rect(x0 + pose.valve - 0.0062, vy - 0.0022, x0 + pose.valve + 0.0062, vy + 0.0022);
    g.fillStyle = cssHex(PART_COLORS.radiusRod);
    g.fillRect(X(pose.dieBlock.x) - 4, Y(pose.dieBlock.y) - 4, 8, 8);
    for (const v of [pose.crankPin, pose.eccPin, pose.crosshead, pose.dropPin, pose.linkTail, pose.leverTop, pose.leverMid, pose.leverBottom]) pin(v);
    // fixed pivot of the expansion link
    pin(pose.linkPivot, 4);
    g.strokeStyle = '#e6edf3';
    const pv = S(pose.linkPivot);
    line(g, { x: pv.x - 7, y: pv.y + 9 }, { x: pv.x + 7, y: pv.y + 9 });
    line(g, pv, { x: pv.x - 5, y: pv.y + 9 });
    line(g, pv, { x: pv.x + 5, y: pv.y + 9 });

    // labels
    g.textBaseline = 'alphabetic';
    // keep these two labels on opposite sides: the rods cross each other during a revolution
    const mMain = mid(pose.crankPin, pose.crosshead);
    const mEcc = mid(pose.eccPin, pose.linkTail);
    const eccAbove = mEcc.y >= mMain.y;
    tag('mainRod', mMain, 0, eccAbove ? 18 : -9);
    tag('eccRod', mEcc, 0, eccAbove ? -8 : 17);
    tag('coupling', { x: LAYOUT.driverX[3] / 2 + pose.crankPin.x, y: pose.crankPin.y }, 0, -8);
    g.fillStyle = cssHex(PART_COLORS.link);
    g.textAlign = 'center';
    g.fillText(t(PART_LABELS.link) + t('（支点固定）'), X(linkTop.x), Y(linkTop.y) - 9);
    tag('radiusRod', mid(pose.dieBlock, pose.leverTop), 6, -8);
    tag('lever', mid(pose.leverMid, pose.leverBottom), 8, 4, 'left');
    tag('union', mid(pose.leverBottom, pose.dropPin), 0, 16);
    tag('crosshead', { x: pose.crosshead.x, y: -0.0052 }, -10, 13, 'right');
    tag('valve', { x: x0, y: vy + 0.0045 }, 0, -6);
    const rc = { x: -0.024, y: -0.0195 };
    tag('returnCrank', rc, 0, 0);
    g.strokeStyle = cssHex(PART_COLORS.returnCrank);
    g.lineWidth = 1;
    line(g, { x: X(rc.x) + 8, y: Y(rc.y) - 12 }, S(mid(pose.crankPin, pose.eccPin)));
    g.fillStyle = DIM;
    g.textAlign = 'center';
    g.fillText(t('气缸 / 活塞'), X(x0), Y(-bore - WALL) + 14);

    g.fillStyle = TEXT;
    g.textAlign = 'left';
    const u = sim.controls.reverser;
    const gearName = Math.abs(u) < 0.03 ? '中立' : u > 0 ? '前进' : '后退';
    wrappedText(g, t('右侧 Walschaerts 配气机构 · 回动手柄 {percent}%（{gear}）· 滑块离月牙板支点越远，阀行程越大；过支点则反向', {
      percent: (u * 100).toFixed(0), gear: t(gearName),
    }), 8, 14, W - 16);
  }

  // ---------------------------------------------------------------- water, steam and heat

  private drawFlow(g: G, W: number, H: number): void {
    const sim = this.sim;
    const b = sim.boiler;
    const c = sim.controls;
    const s = Math.min(W / 760, H / 270);
    g.save();
    g.translate((W - 760 * s) / 2, 0);
    g.scale(s, s);
    const C = FLOW_COLORS;
    const gps = (kg: number) => (kg * 1e3).toFixed(3) + ' g/s';
    const watts = (w: number) => w.toFixed(0) + ' W';

    const node = (x: number, y: number, w: number, h: number, title: string, value = '') => {
      g.fillStyle = '#161b22';
      g.strokeStyle = '#484f58';
      g.lineWidth = 1;
      g.setLineDash([]);
      g.beginPath();
      g.roundRect(x, y, w, h, 5);
      g.fill();
      g.stroke();
      g.textAlign = 'center';
      g.fillStyle = '#9ecbff';
      g.fillText(t(title), x + w / 2, y + (value ? 15 : h / 2 + 4), w - 6);
      g.fillStyle = TEXT;
      if (value) g.fillText(value, x + w / 2, y + 30, w - 6);
    };
    /** Polyline whose dashes travel at a speed following the flow; a stopped flow is drawn dim and solid. */
    const pipe = (id: string, pts: number[], color: string, flow: number, ref: number, width = 3) => {
      const speed = flow > ref * 1e-4 ? 18 + 70 * Math.min(1, flow / ref) : 0;
      const off = ((this.dash.get(id) ?? 0) + speed * this.dt) % 13;
      this.dash.set(id, off);
      g.strokeStyle = g.fillStyle = color;
      g.globalAlpha = speed ? 1 : 0.3;
      g.lineWidth = width;
      g.setLineDash(speed ? [7, 6] : []);
      g.lineDashOffset = -off;
      g.beginPath();
      g.moveTo(pts[0], pts[1]);
      for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
      g.stroke();
      g.setLineDash([]);
      const n = pts.length;
      arrow(g, pts[n - 4], pts[n - 3], pts[n - 2], pts[n - 1], 7);
      g.globalAlpha = 1;
    };
    const note = (text: string, x: number, y: number, color: string = DIM, align: CanvasTextAlign = 'center') => {
      g.fillStyle = color;
      g.textAlign = align;
      const width = align === 'left' ? 748 - x : align === 'right' ? x - 8 : 2 * Math.min(x - 8, 748 - x);
      g.fillText(text, x, y, width);
    };

    const water = cssHex(C.water);
    const heat = cssHex(C.heat);
    const boilerSteam = pressureCss(b.P);
    const chestSteam = pressureCss(sim.engine.chestP);
    const burnMl = (sim.firePower / sim.params.burner.lhv / sim.params.burner.fuelDensity) * 6e7;
    const flueLoss = Math.max(0, sim.firePower - sim.heatToWater);
    const wheelPower = Math.abs(sim.tractiveForce * sim.v);

    // pipes first, nodes on top
    pipe('pump', [104, 93, 140, 93], water, sim.pumpFlow, 4e-4);
    pipe('feed', [210, 93, 250, 93], water, sim.feedFlow, 4e-4);
    pipe('bypass', [226, 93, 226, 142, 58, 142, 58, 124], cssHex(C.bypass), sim.pumpFlow - sim.feedFlow, 4e-4, 2);
    pipe('steam1', [420, 60, 452, 60], boilerSteam, sim.steamFlow, 3e-4);
    pipe('steam2', [516, 60, 540, 60], chestSteam, sim.steamFlow, 3e-4);
    pipe('steam3', [604, 60, 628, 60], chestSteam, sim.steamFlow, 3e-4);
    pipe('steam4', [659, 78, 659, 104], chestSteam, sim.steamFlow, 3e-4);
    pipe('exhaust', [690, 124, 712, 124], cssHex(C.exhaust), sim.exhaustFlow, 3e-4);
    pipe('blower', [400, 38, 400, 20, 730, 20, 730, 28], boilerSteam, sim.blowerFlow, 5e-5, 2);
    pipe('safety', [290, 38, 290, 16], boilerSteam, sim.safetyFlow, 5e-4, 2);
    pipe('fuel', [104, 204, 250, 204], cssHex(C.fuel), sim.firePower, 1600);
    pipe('work', [659, 144, 659, 176], '#e3b341', Math.abs(sim.indicatedPower), 30);

    node(12, 64, 92, 58, '水柜', (sim.tenderWater * 1e6).toFixed(0) + ' mL');
    node(140, 74, 70, 38, '轴泵', gps(sim.pumpFlow));
    node(452, 42, 64, 36, '加减阀', (c.regulator * 100).toFixed(0) + '%');
    node(540, 42, 64, 36, '过热器', '+' + sim.superheat.toFixed(0) + ' K');
    node(628, 42, 62, 36, '汽室', ((sim.engine.chestP - P_ATM) / KGF_CM2).toFixed(2));
    node(628, 104, 62, 40, '气缸 ×2', watts(sim.indicatedPower));
    node(628, 176, 62, 40, '车轮', watts(wheelPower));
    node(12, 184, 92, 40, '酒精箱', (sim.fuel * 1e6).toFixed(0) + ' mL');
    node(250, 184, 170, 40, '酒精燃烧器', sim.lit ? t('火力 {percent}% · {power}', { percent: (sim.fireGain * 100).toFixed(0), power: watts(sim.firePower) }) : t('未点火'));
    node(712, 28, 36, 152, '', '');
    g.save();
    g.translate(734, 104);
    g.rotate(-Math.PI / 2);
    g.textAlign = 'center';
    g.fillStyle = '#9ecbff';
    g.fillText(t('烟囱'), 0, 0, 136);
    g.restore();

    // boiler: water below (colour = temperature), steam above (colour = pressure)
    const bx = 250;
    const by = 38;
    const bw = 170;
    const bh = 98;
    const hot = Math.min(1, Math.max(0, (b.T - 293) / 130));
    g.save();
    g.beginPath();
    g.roundRect(bx, by, bw, bh, 12);
    g.clip();
    g.fillStyle = '#161b22';
    g.fillRect(bx, by, bw, bh);
    g.fillStyle = pressureCss(b.P, 0.25 + 0.5 * Math.min(1, b.gaugePressure / (4 * KGF_CM2)));
    g.fillRect(bx, by, bw, bh);
    const wl = bh * Math.min(1, b.fill);
    g.fillStyle = `hsl(${(216 - 43 * hot).toFixed(0)}, 75%, ${(42 + 16 * hot).toFixed(0)}%)`;
    g.fillRect(bx, by + bh - wl, bw, wl);
    g.restore();
    g.strokeStyle = '#8b949e';
    g.lineWidth = 1.5;
    g.beginPath();
    g.roundRect(bx, by, bw, bh, 12);
    g.stroke();
    // the two flue tubes run through the water: flue gas inside, heat passing out through their walls
    const gas = cssHex(C.gas);
    g.fillStyle = 'rgba(255, 159, 46, 0.2)';
    g.strokeStyle = gas;
    g.lineWidth = 1;
    g.fillRect(bx + 8, 98, bw - 8, 28);
    g.strokeRect(bx + 8, 98, bw - 8, 28);
    pipe('flue', [266, 184, 266, 119, 440, 119, 440, 240, 730, 240, 730, 180], gas, sim.lit ? flueLoss : 0, 1000);
    for (const x of [300, 345, 390]) pipe('heat' + x, [x, 97, x, 81], heat, sim.heatToWater, 600, 2);
    note(t('烟管 ×2（内插过热器）'), bx + bw / 2 + 10, 110, '#ffffff');
    note(t('锅炉 · 水位 {percent}%', { percent: (b.glass * 100).toFixed(0) }), bx + bw / 2, by + 15, '#ffffff');
    note(`${(b.gaugePressure / KGF_CM2).toFixed(2)} kgf/cm² · ${(b.T - 273.15).toFixed(0)} °C`, bx + bw / 2, by + 31, '#ffffff');

    note(t('给水') + ' ' + gps(sim.feedFlow), 238, 68, water, 'right');
    note(t('旁通回水') + ' ' + gps(Math.max(0, sim.pumpFlow - sim.feedFlow)), 142, 156, cssHex(C.bypass));
    note(t('蒸汽') + ' ' + gps(sim.steamFlow), 528, 36, TEXT);
    note(t('通风阀') + ' ' + gps(sim.blowerFlow), 565, 16, DIM);
    note(t(sim.safetyOpen ? '安全阀开' : '安全阀'), 290, 12, sim.safetyOpen ? '#f85149' : DIM);
    note(t('酒精') + ' ' + burnMl.toFixed(1) + ' mL/min', 177, 198, cssHex(C.fuel));
    note(t('传给水') + ' ' + watts(sim.heatToWater), 345, 163, heat);
    note(t('两根 U 形管，插在烟管内'), 572, 93, DIM);
    note(t('烟气带走') + ' ' + watts(flueLoss), 512, 234, cssHex(C.gas));
    note(t('散热') + ' ' + watts(sim.boilerLoss), 246, 30, DIM, 'right');
    note(t('排汽'), 706, 153, DIM, 'right');
    note(t('活塞功'), 651, 164, '#e3b341', 'right');
    note(t(c.fan ? '通风机抽风' : '排汽 / 通风阀抽风'), 722, 232, DIM, 'right');

    const pct = (a: number, base: number) => (base > 1 ? ((100 * a) / base).toFixed(1) + '%' : '–');
    note(
      t('能量：燃料 {fuel} → 水 {water}（{waterEfficiency}）→ 指示功 {indicated} → 轮周 {wheel} · 总效率 {efficiency}', {
        fuel: watts(sim.firePower), water: watts(sim.heatToWater), waterEfficiency: pct(sim.heatToWater, sim.firePower),
        indicated: watts(sim.indicatedPower), wheel: watts(wheelPower), efficiency: pct(wheelPower, sim.firePower),
      }),
      12,
      264,
      TEXT,
      'left',
    );
    g.restore();
  }
}
