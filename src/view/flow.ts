import * as THREE from 'three';
import { t } from '../i18n';
import type { LocoSim } from '../sim/loco';
import { RUNNING_GEAR } from '../sim/runningGear';
import { LAYOUT as L, type LocoModel } from './locoModel';
import { pipeCurve, pumpPorts } from './pipeNetwork';

/** One fixed colour per medium, so that a pipe can be identified without reading its pressure. */
export const FLOW_COLORS = {
  water: 0x3b9dff,
  bypass: 0x7ee0f2,
  steam: 0xff5a5a,
  superheated: 0xe45cff,
  exhaust: 0xe6edf3,
  fuel: 0x9be22d,
  gas: 0xff9f2e,
  heat: 0xffd33d,
} as const;
export type FlowKind = keyof typeof FLOW_COLORS;

export const FLOW_LEGEND: [FlowKind, string][] = [
  ['water', '给水'],
  ['bypass', '旁通回水'],
  ['steam', '饱和蒸汽'],
  ['superheated', '过热蒸汽'],
  ['exhaust', '排汽'],
  ['fuel', '酒精'],
  ['gas', '烟气'],
  ['heat', '传热'],
];

export interface FlowLabel {
  kind: FlowKind;
  anchor: THREE.Object3D;
  text: () => string;
}

interface Path {
  kind: FlowKind;
  tube: THREE.Mesh;
  arrows: THREE.InstancedMesh;
  n: number;
  /** arrow head radius [m] */
  size: number;
  /** positions and orientations at equal steps of arc length */
  pos: THREE.Vector3[];
  rot: THREE.Quaternion[];
  phase: number;
  length: number;
  /** arrow speed [m/s] on screen; 0 = no flow, arrows hidden and the pipe dimmed */
  speed: () => number;
}

const UP = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color(0xffffff);
/** arrows grow and shrink over this distance at the two ends of a pipe [m] */
const FADE = 0.006;

/** Visual arrow speed for a mass flow [kg/s]; ref is the flow shown at full speed. */
function pace(flow: number, ref: number): number {
  return flow < 1e-7 ? 0 : 0.025 + 0.11 * Math.min(1, flow / ref);
}

/**
 * Pipes with arrows moving along them, showing where water, steam, fuel, flue gas and heat go.
 * Engine coordinates; the routes follow the model built in locoModel.ts.
 */
export class FlowOverlay {
  readonly group = new THREE.Group();
  readonly labels: FlowLabel[] = [];
  private readonly paths: Path[] = [];
  private readonly hidden = new Set<FlowKind>();
  private readonly head = new THREE.ConeGeometry(1, 2.7, 10);
  private readonly matrix = new THREE.Matrix4();
  private readonly scale = new THREE.Vector3();

  constructor(sim: LocoSim, model: LocoModel) {
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const tender = (x: number, y: number, z: number) => model.tenderToLoco(x, y, z);
    const { flueY: fy, flueZ: fz, flueR: fr, shPitch: sp, steamPipeY: spy, blowerPipeY: bpy, blowerPipeZ: bz, chimneyX: cx, burnerX: bx } = L;
    const burner = sim.params.burner;
    const pump = () => pace(sim.pumpFlow, 4e-4);
    const steam = () => pace(sim.steamFlow, 3e-4);
    const exhaust = () => pace(sim.exhaustFlow, 3e-4);
    const blower = () => pace(sim.blowerFlow, 5e-5);

    // water: tender -> axle pump -> tee -> (clack valve into the boiler | bypass back to the tender)
    const { bodyX, axisY } = RUNNING_GEAR.pump;
    const ports = pumpPorts();
    const pumpInlet = v(...ports.inlet);
    const pumpOutlet = v(...ports.outlet);
    const tee = v(-0.03, 0.024, -0.018);
    this.add('water', [tender(0.08, 0.026, -0.02), tender(0.115, 0.026, -0.02), tender(0.115, 0.008, -0.02), v(-0.175, 0.006, -0.02), v(bodyX, 0.006, -0.02), v(bodyX, axisY, -0.02), pumpInlet], pump);
    this.add('water', [pumpOutlet, v(bodyX, axisY, pumpOutlet.z + 0.008), v(bodyX, axisY + 0.020, pumpOutlet.z + 0.008), v(-0.03, 0.020, pumpOutlet.z + 0.008), v(-0.03, 0.020, -0.018), tee], pump);
    this.add('water', [tee, v(-0.03, 0.05, -0.018)], () => pace(sim.feedFlow, 4e-4));
    this.add('bypass', [tee, v(-0.03, 0.024, -0.03), v(-0.19, 0.024, -0.03), tender(0.1, 0.066, -0.03), tender(0.06, 0.066, -0.03), tender(0.06, 0.05, -0.03)], () => pace(sim.pumpFlow - sim.feedFlow, 4e-4));

    // One overlay per physical run, using exactly the same rounded centreline as the model.
    const speeds = { admission: steam, exhaust, blower };
    for (const run of model.pipework.runs) {
      this.add(run.kind, pipeCurve(run.points), speeds[run.circuit], run.radius <= 0.0011);
    }
    // Free jets have no physical pipe; start them at the shared nozzle nodes, not separate estimates.
    const { blastNozzle, blowerNozzle } = model.pipework.nodes;
    this.add('exhaust', [v(...blastNozzle), v(blastNozzle[0], L.chimneyTop + 0.008, blastNozzle[2])], exhaust);
    this.add('steam', [v(...blowerNozzle), v(blowerNozzle[0], L.chimneyTop + 0.008, blowerNozzle[2])], blower);

    // fuel: alcohol tank in the tender -> feed pipe of the burner
    this.add('fuel', [tender(0.085, 0.04, 0.02), tender(0.115, 0.04, 0.02), tender(0.115, 0.01, 0.02), v(-0.17, 0.0075, 0.012), v(-0.125, 0.0075, 0), v(bx - 0.02, 0.0075, 0)], () => pace(sim.firePower / burner.lhv, 1e-4));
    // flue gas: flames in the firebox -> through the two flues, past the superheater -> smokebox -> chimney
    for (const s of [1, -1]) {
      this.add('gas', [v(bx, 0.024, s * 0.004), v(bx, fy, s * fz), v(0.168, fy, s * fz), v(cx, 0.07, s * 0.0035), v(cx, L.chimneyTop + 0.004, s * 0.0035)], () => (sim.lit ? 0.03 + 0.1 * Math.min(1, sim.fireGain) : 0));
    }
    // heat passing through the flue walls and the firebox crown into the water
    const heat = () => (sim.heatToWater > 1 ? 0.012 + 0.025 * Math.min(1, sim.heatToWater / 600) : 0);
    for (const s of [1, -1]) {
      for (const x of [-0.015, 0.03, 0.075, 0.12]) this.add('heat', [v(x, fy + fr, s * fz), v(x, fy + fr + 0.011, s * (fz + 0.003))], heat, true);
      for (const x of [-0.09, -0.062]) this.add('heat', [v(x, L.crownY, s * 0.012), v(x, L.crownY + 0.011, s * 0.012)], heat, true);
    }

    // Templates own the units; these values contain only the formatted number.
    const gps = (kg: number) => (Math.max(0, kg) * 1e3).toFixed(2);
    this.label('water', -0.03, 0.04, -0.018, () => t('给水 {flow} g/s', { flow: gps(sim.feedFlow) }));
    this.label('bypass', -0.12, 0.024, -0.03, () => t('旁通回水 {flow} g/s', { flow: gps(sim.pumpFlow - sim.feedFlow) }));
    this.label('steam', -0.035, spy, 0, () => t('饱和蒸汽 {flow} g/s', { flow: gps(sim.steamFlow) }));
    this.label('steam', 0.11, bpy, bz, () => t('通风 {flow} g/s', { flow: gps(sim.blowerFlow) }));
    this.label('superheated', 0.06, fy + sp, fz, () => t('过热器 +{temperature} K', { temperature: sim.superheat.toFixed(0) }));
    this.label('exhaust', cx, 0.03, 0, () => t('排汽 {flow} g/s', { flow: gps(sim.exhaustFlow) }));
    this.label('gas', 0.005, fy - fr, -fz, () => t('烟气（烟管 ×2）'));
    this.label('fuel', -0.15, 0.0075, 0.01, () => t('酒精 {flow} mL/min', { flow: ((sim.firePower / burner.lhv / burner.fuelDensity) * 6e7).toFixed(1) }));
    this.label('heat', -0.076, L.crownY + 0.011, 0.012, () => t('传给水 {power} W', { power: sim.heatToWater.toFixed(0) }));
  }

  /** Show or hide every pipe of one medium. */
  setKind(kind: FlowKind, on: boolean): void {
    if (on) this.hidden.delete(kind);
    else this.hidden.add(kind);
  }

  shows(kind: FlowKind): boolean {
    return !this.hidden.has(kind);
  }

  private label(kind: FlowKind, x: number, y: number, z: number, text: () => string): void {
    const anchor = new THREE.Object3D();
    anchor.position.set(x, y, z);
    this.group.add(anchor);
    this.labels.push({ kind, anchor, text });
  }

  /** small = thin pipe with small arrows, for narrow pipework and heat transfer. */
  private add(kind: FlowKind, pts: THREE.Vector3[] | THREE.Curve<THREE.Vector3>, speed: () => number, small = false): void {
    const color = FLOW_COLORS[kind];
    const path = Array.isArray(pts) ? pipeCurve(pts.map(p => [p.x, p.y, p.z])) : pts;
    const length = path.getLength();
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(path, Math.max(4, Math.round(length / 0.002)), small ? 0.0008 : 0.0013, 8),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    tube.renderOrder = 6;

    const samples = Math.max(4, Math.ceil(length / 0.0012));
    const pos: THREE.Vector3[] = [];
    const rot: THREE.Quaternion[] = [];
    for (let k = 0; k < samples; k++) {
      const u = k / (samples - 1);
      pos.push(path.getPointAt(u));
      rot.push(new THREE.Quaternion().setFromUnitVectors(UP, path.getTangentAt(u).normalize()));
    }
    const n = Math.max(1, Math.round(length / (small ? 0.013 : 0.022)));
    const arrows = new THREE.InstancedMesh(this.head, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).lerp(WHITE, 0.3), transparent: true, depthWrite: false }), n);
    arrows.frustumCulled = false;
    arrows.renderOrder = 7;
    this.group.add(tube, arrows);
    this.paths.push({ kind, tube, arrows, n, size: small ? 0.0018 : 0.0027, pos, rot, phase: Math.random(), length, speed });
  }

  update(dt: number): void {
    for (const path of this.paths) {
      const shown = !this.hidden.has(path.kind);
      const sp = shown ? path.speed() : 0;
      path.tube.visible = shown;
      path.arrows.visible = sp > 0;
      (path.tube.material as THREE.MeshBasicMaterial).opacity = sp > 0 ? 0.7 : 0.25;
      if (sp <= 0) continue;
      path.phase = (path.phase + (sp * dt) / path.length) % 1;
      const last = path.pos.length - 1;
      for (let i = 0; i < path.n; i++) {
        const u = (path.phase + i / path.n) % 1;
        const k = Math.round(u * last);
        const size = path.size * Math.min(1, (u * path.length) / FADE, ((1 - u) * path.length) / FADE);
        path.arrows.setMatrixAt(i, this.matrix.compose(path.pos[k], path.rot[k], this.scale.setScalar(Math.max(1e-6, size))));
      }
      path.arrows.instanceMatrix.needsUpdate = true;
    }
  }
}
