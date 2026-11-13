import { bindStaticText, onLocaleChange, t } from '../i18n';
import { portOpenings } from '../sim/engine';
import type { LocoSim } from '../sim/loco';
import { RUNNING_GEAR, pumpPose, sidePhase, wrapAngle, type PumpPose } from '../sim/runningGear';
import { PUMP_BODY } from './pipeNetwork';

const DEG = 180 / Math.PI;
const PORT_TEXT = { admission: '进汽', exhaust: '排汽', closed: '关闭' } as const;
const PUMP_TEXT = { suction: '吸水', delivery: '压水', stopped: '停止', deadCentre: '死点' } as const;

/** These are geometric port states, not a claim that steam is actually flowing. */
export function portState(admission: number, exhaust: number): keyof typeof PORT_TEXT {
  return admission > 0 ? 'admission' : exhaust > 0 ? 'exhaust' : 'closed';
}

export function pumpState(pose: PumpPose, omega: number): keyof typeof PUMP_TEXT {
  if (Math.abs(omega) < 1e-8) return 'stopped';
  // Compare travel per radian so slow motion is not mistaken for a dead centre.
  if (Math.abs(pose.velocity / omega) < 1e-10) return 'deadCentre';
  return pose.delivering ? 'delivery' : 'suction';
}

/** Uniform SVG projection fitted to the body and the entire offset linkage sweep. */
export function pumpSvgGeometry(pose: PumpPose) {
  const { bodyX, axisY, rodLength, eccentricRadius } = RUNNING_GEAR.pump;
  const axleX = RUNNING_GEAR.driverX[RUNNING_GEAR.pumpAxle];
  const { length: bodyLength, radius: bodyRadius } = PUMP_BODY;
  const minX = Math.min(bodyX - bodyLength / 2, axleX - rodLength - eccentricRadius);
  const maxX = Math.max(bodyX + bodyLength / 2, axleX + eccentricRadius);
  const minY = Math.min(axisY - bodyRadius, -eccentricRadius);
  const maxY = Math.max(axisY + bodyRadius, eccentricRadius);
  const width = 210, padding = 12, labelSpace = 16;
  const scale = (width - 2 * padding) / (maxX - minX);
  const height = (maxY - minY) * scale + 2 * padding + labelSpace;
  const x = (metres: number) => padding + (metres - minX) * scale;
  const y = (metres: number) => padding + (maxY - metres) * scale;
  const project = (point: { x: number; y: number }) => ({ x: x(point.x), y: y(point.y) });
  return {
    width, height, labelY: height - 5, left: padding, right: width - padding,
    body: { x: x(bodyX - bodyLength / 2), y: y(axisY + bodyRadius), width: bodyLength * scale, height: 2 * bodyRadius * scale },
    axle: project({ x: axleX, y: 0 }), radius: eccentricRadius * scale,
    eccentric: project(pose.eccentric), ram: project(pose.ram),
    ramStart: project({ x: bodyX - 0.004, y: axisY }),
  };
}

/** Read-only snapshot: solve directly so a paused reverser edit never uses a stale valve table. */
export function phaseValues(sim: LocoSim, paused: boolean) {
  const sides = ([0, 1] as const).map(side => {
    const phase = wrapAngle(sidePhase(wrapAngle(sim.phi), side));
    const pose = sim.gear.solve(phase, sim.controls.reverser);
    const ports = portOpenings(sim.params.engine, pose.valve, { admFront: 0, admBack: 0, exhFront: 0, exhBack: 0 });
    // All four coupled axles use the same model phase; this is not a measured axle sensor.
    const drivers = RUNNING_GEAR.driverX.map(() => phase);
    const sameSideError = Math.max(...drivers.map(angle => Math.abs(Math.atan2(Math.sin(angle - phase), Math.cos(angle - phase)))));
    const rodError = Math.abs(Math.hypot(pose.crosshead.x - pose.crankPin.x, pose.crosshead.y - pose.crankPin.y) - sim.params.gear.conRod);
    return {
      phase, pose, drivers, sameSideError, rodError,
      front: portState(ports.admFront, ports.exhFront),
      back: portState(ports.admBack, ports.exhBack),
    };
  });
  const omega = paused ? 0 : sim.omega;
  const pump = pumpPose(sim.phi, omega);
  return {
    sides, pump, pumpState: pumpState(pump, omega),
    quartering: wrapAngle(sides[1].phase - sides[0].phase),
    rodError: Math.max(...sides.map(side => side.rodError)),
  };
}

/** Never teleport live physics, even if a stale/programmatic UI event bypasses disabled controls. */
export function positionPaused(sim: LocoSim, paused: boolean, degrees: number): boolean {
  if (!paused || !Number.isFinite(degrees)) return false;
  const wallT = (sim.engine.wallT[0] + sim.engine.wallT[1]) / 2;
  sim.phi = wrapAngle((degrees % 360) / DEG);
  sim.omega = sim.v = 0;
  sim.engine.reset(wallT, sim.phi);
  return true;
}

// Round before wrapping to avoid displaying 360.0° for a phase just below zero.
const angleText = (radians: number) => ((Math.round(wrapAngle(radians) * DEG * 10) / 10) % 360).toFixed(1);
const mm = (metres: number) => (Math.abs(metres) < 0.000005 ? 0 : metres * 1e3).toFixed(2);

/** A small, persistent DOM/SVG dashboard; no per-frame element creation or event rebinding. */
export class PhaseBoard {
  private readonly positioning: HTMLFieldSetElement;
  private readonly angle: HTMLInputElement;
  private readonly nodes = new Map<string, Element>();

  constructor(
    private readonly sim: LocoSim,
    private readonly state: { paused: boolean },
    root: HTMLElement,
  ) {
    const svg = pumpSvgGeometry(pumpPose(sim.phi, 0));
    root.innerHTML = `
      <div class="phase-heading"><h3 id="phaseTitle" data-i18n>相位监视</h3><span data-phase="mode"></span></div>
      <p class="phase-note" data-i18n>曲柄角：从前方 +x 顺时针</p>
      <fieldset id="phasePositioning" disabled aria-describedby="phaseResetNote">
        <legend data-i18n>左曲柄定位（仅暂停时）</legend>
        <div class="phase-scrub">
          <button type="button" data-step="-15" aria-label="左曲柄减小 15°" data-i18n-attrs="aria-label">−15°</button>
          <input id="phaseAngle" type="range" min="0" max="360" step="1" value="0" aria-label="左曲柄角度" data-i18n-attrs="aria-label" />
          <button type="button" data-step="15" aria-label="左曲柄增加 15°" data-i18n-attrs="aria-label">+15°</button>
        </div>
        <div class="phase-references">${[0, 90, 180, 270].map(angle => `<button type="button" data-angle="${angle}">${angle}°</button>`).join('')}</div>
      </fieldset>
      <p id="phaseResetNote" class="phase-caution" data-i18n>暂停定位会重置气缸状态；锅炉、时间和燃料不变。</p>
      <div class="phase-sides">${['左侧', '右侧'].map((source, side) => `
        <section class="phase-side" aria-labelledby="phaseSide${side}">
          <h4 id="phaseSide${side}" data-i18n>${source}</h4>
          <svg class="phase-dial" viewBox="0 0 100 100" aria-hidden="true">
            <circle class="phase-rim" cx="50" cy="50" r="32" />
            <path class="phase-axis" d="M14 50H86 M50 14V86" />
            <text x="92" y="53">0</text><text x="50" y="96">90</text>
            <text x="9" y="53">180</text><text x="50" y="10">270</text>
            <g data-phase="needle${side}"><path class="phase-needle" d="M50 50H78" /><circle cx="78" cy="50" r="3" /></g>
            <circle cx="50" cy="50" r="3" />
          </svg>
          <strong class="phase-angle" data-phase="angle${side}"></strong>
          <dl class="phase-values">
            <div><dt data-i18n>活塞 mm</dt><dd data-phase="piston${side}"></dd></div>
            <div><dt data-i18n>滑阀 mm</dt><dd data-phase="valve${side}"></dd></div>
            <div><dt data-i18n>回动曲柄销角度</dt><dd data-phase="returnCrank${side}"></dd></div>
          </dl>
          <div class="phase-port"><span data-i18n>前端</span><b data-phase="front${side}"></b></div>
          <div class="phase-port"><span data-i18n>后端</span><b data-phase="back${side}"></b></div>
          <div class="phase-drivers" aria-hidden="true">${RUNNING_GEAR.driverX.map((_, axle) => `
            <div class="${axle === RUNNING_GEAR.mainAxle ? 'phase-main-axle' : ''}">
              <svg viewBox="0 0 24 24"><circle class="phase-rim" cx="12" cy="12" r="10" /><path class="phase-needle" data-phase="driver${side}-${axle}" d="M12 12H21" /></svg>
              <span>${axle + 1}</span>
            </div>`).join('')}
          </div>
          <p class="phase-note" data-phase="coupled${side}"></p>
        </section>`).join('')}
      </div>
      <p class="phase-check" data-phase="quartering"></p>
      <p class="phase-note" data-i18n>位移：中位为零、向前为正；汽口仅表示几何开闭。</p>
      <p class="phase-note" data-i18n>图 9：前死点时回动曲柄销在轴心上方，半径杆接合并杆上销；气缸汽道交叉。</p>
      <section class="phase-pump" aria-labelledby="phasePumpTitle">
        <div class="phase-heading"><h4 id="phasePumpTitle" data-phase="pumpTitle"></h4><b data-phase="pumpState"></b></div>
        <p class="phase-note" data-i18n>图 6、图 6.2：柱塞沿车身前后水平往复，止回阀腔沿车宽横置。</p>
        <p class="phase-note" data-i18n>下图为侧视：x 向前，y 向上；不是竖直柱塞泵。</p>
        <svg class="phase-pump-pose" viewBox="0 0 ${svg.width} ${svg.height}" aria-hidden="true">
          <path class="phase-axis" d="M${svg.left} ${svg.ram.y}H${svg.right}" />
          <rect class="phase-pump-body" x="${svg.body.x}" y="${svg.body.y}" width="${svg.body.width}" height="${svg.body.height}" rx="3" />
          <circle class="phase-rim" cx="${svg.axle.x}" cy="${svg.axle.y}" r="${svg.radius}" />
          <path class="phase-needle" data-phase="pumpCrank" />
          <path class="phase-pump-rod" data-phase="pumpRod" />
          <path class="phase-pump-ram" data-phase="pumpRam" />
          <circle data-phase="pumpPin" r="3" />
          <text x="${svg.left}" y="${svg.labelY}">−x</text><text x="${svg.right}" y="${svg.labelY}" text-anchor="end">+x</text>
        </svg>
        <p class="phase-check" data-phase="pumpPhase"></p>
        <meter data-phase="pumpStroke" min="0" max="1" value="0" aria-label="轴泵行程比例" data-i18n-attrs="aria-label"></meter>
        <dl class="phase-values">
          <div><dt data-i18n>偏心 x / y mm</dt><dd data-phase="eccentric"></dd></div>
          <div><dt data-i18n>柱塞 x / y mm</dt><dd data-phase="ram"></dd></div>
          <div><dt data-i18n>柱塞速度 mm/s</dt><dd data-phase="velocity"></dd></div>
        </dl>
        <p class="phase-note" data-phase="pumpCapacity"></p>
      </section>
      <p class="phase-note phase-residual" data-phase="residual"></p>
      <p class="phase-evidence" data-i18n>图 5–7：四轴联动，第 3 轴主传动及轴泵；右侧超前为约定，泵相位与尺寸为估计。</p>`;

    for (const el of root.querySelectorAll<HTMLElement>('[data-phase]')) this.nodes.set(el.dataset.phase!, el);
    this.positioning = root.querySelector<HTMLFieldSetElement>('fieldset')!;
    this.angle = root.querySelector<HTMLInputElement>('#phaseAngle')!;
    const position = (degrees: number) => {
      positionPaused(sim, state.paused, degrees);
      this.update();
    };
    this.angle.addEventListener('input', () => position(Number(this.angle.value)));
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-step]')) {
      button.addEventListener('click', () => position(wrapAngle(sim.phi) * DEG + Number(button.dataset.step)));
    }
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-angle]')) {
      button.addEventListener('click', () => position(Number(button.dataset.angle)));
    }
    // main.ts has already bound the original document. Capture these NEW Chinese
    // source nodes exactly once, before translating, including on saved-locale startup.
    bindStaticText(root);
    onLocaleChange(() => this.update());
    this.update();
  }

  private text(key: string, value: string): void {
    const node = this.nodes.get(key)!;
    if (node.textContent !== value) node.textContent = value;
  }

  private attr(key: string, name: string, value: string): void {
    const node = this.nodes.get(key)!;
    if (node.getAttribute(name) !== value) node.setAttribute(name, value);
  }

  update(): void {
    const values = phaseValues(this.sim, this.state.paused);
    this.positioning.disabled = !this.state.paused;
    this.text('mode', t(this.state.paused ? '已暂停 · 可定位' : '运行中 · 定位已锁定'));
    this.angle.value = String(Math.round(wrapAngle(this.sim.phi) * DEG) % 360);
    this.angle.setAttribute('aria-valuetext', `${angleText(this.sim.phi)}°`);
    values.sides.forEach((side, i) => {
      this.attr(`needle${i}`, 'transform', `rotate(${side.phase * DEG} 50 50)`);
      this.text(`angle${i}`, `${angleText(side.phase)}°`);
      this.text(`piston${i}`, mm(side.pose.piston));
      this.text(`valve${i}`, mm(side.pose.valve));
      this.text(`returnCrank${i}`, `${angleText(Math.atan2(-side.pose.eccPin.y, side.pose.eccPin.x))}°`);
      for (const end of ['front', 'back'] as const) {
        this.text(`${end}${i}`, t(PORT_TEXT[side[end]]));
        this.attr(`${end}${i}`, 'data-state', side[end]);
      }
      side.drivers.forEach((phase, axle) => this.attr(`driver${i}-${axle}`, 'transform', `rotate(${phase * DEG} 12 12)`));
      this.text(`coupled${i}`, t('同侧四轴相差 ≤ {angle}°', { angle: (side.sameSideError * DEG).toFixed(1) }));
    });
    this.text('quartering', t('右 − 左：{angle}°（模型约定）', { angle: angleText(values.quartering) }));
    this.text('residual', t('主连杆长度误差最大 {error} mm', { error: (values.rodError * 1e3).toFixed(3) }));
    this.attr('residual', 'data-error', String(values.rodError > 1e-6));

    const pump = values.pump;
    this.text('pumpTitle', t('第 {axle} 动轴 · 轴泵', { axle: RUNNING_GEAR.pumpAxle + 1 }));
    this.text('pumpState', t(PUMP_TEXT[values.pumpState]));
    this.attr('pumpState', 'data-state', values.pumpState);
    this.text('pumpPhase', t('相位 {angle}° · 行程 {percent}%', { angle: angleText(pump.phase), percent: (pump.strokeFraction * 100).toFixed(1) }));
    this.attr('pumpStroke', 'value', String(pump.strokeFraction));
    this.text('eccentric', `${mm(pump.eccentric.x)} / ${mm(pump.eccentric.y)}`);
    this.text('ram', `${mm(pump.ram.x)} / ${mm(pump.ram.y)}`);
    this.text('velocity', mm(pump.velocity));
    this.text('pumpCapacity', t('正反转均每转一冲程 · 估计 {volume} mL/转（旁通前）', { volume: (this.sim.params.feed.axlePumpPerRev * 1e6).toFixed(3) }));
    const svg = pumpSvgGeometry(pump);
    const { x: ex, y: ey } = svg.eccentric, { x: rx, y: ry } = svg.ram;
    this.attr('pumpCrank', 'd', `M${svg.axle.x} ${svg.axle.y}L${ex} ${ey}`);
    this.attr('pumpRod', 'd', `M${ex} ${ey}L${rx} ${ry}`);
    this.attr('pumpRam', 'd', `M${svg.ramStart.x} ${svg.ramStart.y}H${rx}`);
    this.attr('pumpPin', 'cx', String(ex));
    this.attr('pumpPin', 'cy', String(ey));
  }
}