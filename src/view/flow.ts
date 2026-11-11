import * as THREE from 'three';
import type { LocoSim } from '../sim/loco';
import { pressureHue } from './colors';
import { LAYOUT as L, type LocoModel } from './locoModel';

export const FLOW_COLORS = {
  water: 0x58a6ff,
  bypass: 0x9ecbff,
  steam: 0xff6b6b,
  exhaust: 0xd0d7de,
  fuel: 0xa3e635,
  gas: 0xf0883e,
  heat: 0xff3b30,
} as const;

export const FLOW_LEGEND: [keyof typeof FLOW_COLORS, string][] = [
  ['water', '给水'],
  ['bypass', '旁通回水'],
  ['steam', '蒸汽（颜色随压力）'],
  ['exhaust', '排汽'],
  ['fuel', '酒精'],
  ['gas', '烟气'],
  ['heat', '传热'],
];

interface Path {
  curve: THREE.CatmullRomCurve3;
  points: THREE.Points;
  tube: THREE.Mesh;
  n: number;
  phase: number;
  length: number;
  /** particle speed [m/s] on screen; 0 hides the particles */
  speed: () => number;
  /** live pressure [Pa] for steam paths */
  pressure?: () => number;
}

/** Visual particle speed for a mass flow [kg/s]; ref is the flow shown at full speed. */
function pace(flow: number, ref: number): number {
  return flow < 1e-7 ? 0 : 0.03 + 0.17 * Math.min(1, flow / ref);
}

/** Pipes with moving particles showing where water, steam, fuel, flue gas and heat go. Engine coordinates. */
export class FlowOverlay {
  readonly group = new THREE.Group();
  private readonly paths: Path[] = [];
  private readonly dot: THREE.Texture;

  constructor(sim: LocoSim, model: LocoModel) {
    this.dot = this.makeDot();
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const t = (x: number, y: number, z: number) => model.tenderToLoco(x, y, z);
    const vy = sim.params.gear.valveSpindleY;
    const x0 = model.cylX0;
    const top = L.innerY + L.innerR - 0.004;
    const C = FLOW_COLORS;
    const lhv = sim.params.burner.lhv;

    // water: tender -> axle pump -> (boiler | bypass back to the tender)
    this.add(C.water, [t(0.1, 0.022, -0.02), t(0.112, 0.004, -0.014), v(-0.17, 0, -0.012), v(-0.06, -0.003, -0.011), v(L.pumpX, -0.004, -0.007)], () => pace(sim.pumpFlow, 4e-4));
    const tee = v(-0.1, 0.02, -0.013);
    this.add(C.water, [v(L.pumpX - 0.008, -0.004, -0.007), v(0.01, 0.01, -0.012), v(-0.09, 0.014, -0.013), tee], () => pace(sim.pumpFlow, 4e-4));
    this.add(C.water, [tee, v(-0.108, 0.04, -0.012), v(L.innerX0, L.innerY - 0.008, -0.008), v(L.innerX0 + 0.02, L.innerY - 0.012, -0.004)], () => pace(sim.feedFlow, 4e-4));
    this.add(C.bypass, [tee, v(-0.13, 0.024, -0.03), v(-0.185, 0.02, -0.03), t(0.1, 0.06, -0.03), t(0.07, 0.06, -0.03)], () => pace(sim.pumpFlow - sim.feedFlow, 4e-4));

    // steam: dome -> regulator -> superheater in the gas path -> both valve chests
    const split = v(0.163, 0.04, 0);
    const boilerP = () => sim.boiler.P;
    const chestP = () => sim.engine.chestP;
    this.add(C.steam, [v(0.07, top, 0), v(-0.09, top, 0), v(-0.108, L.innerY + 0.008, 0.004), v(-0.108, 0.04, 0.0125), v(-0.06, 0.037, 0.0125)], () => pace(sim.steamFlow, 3e-4), boilerP);
    this.add(C.steam, [v(-0.06, 0.037, 0.0125), v(0.14, 0.037, 0.0125), split], () => pace(sim.steamFlow, 3e-4), chestP);
    for (const s of [1, -1]) {
      this.add(C.steam, [split, v(0.16, 0.036, s * 0.018), v(x0, vy + 0.003, s * L.cylZ)], () => pace(sim.steamFlow, 3e-4), chestP);
      this.add(C.exhaust, [v(x0, vy - 0.002, s * 0.03), v(0.17, 0.028, s * 0.012), v(L.chimneyX, L.blastY, 0)], () => pace(sim.exhaustFlow, 3e-4));
    }
    this.add(C.exhaust, [v(L.chimneyX, L.blastY, 0), v(L.chimneyX, 0.08, 0), v(L.chimneyX, L.chimneyTop + 0.004, 0)], () => pace(sim.exhaustFlow + sim.blowerFlow, 3e-4));
    // blower: boiler steam blown up the chimney to draw the fire
    this.add(
      C.steam,
      [v(-0.1, top, -0.006), v(-0.108, L.innerY + 0.012, -0.012), v(-0.09, L.innerY + 0.004, -0.0255), v(0.14, L.innerY + 0.004, -0.0255), v(L.chimneyX - 0.004, L.blastY + 0.004, -0.003), v(L.chimneyX - 0.002, 0.075, 0)],
      () => pace(sim.blowerFlow, 5e-5),
      boilerP,
    );

    // fuel: alcohol tank in the tender -> burner sump
    this.add(C.fuel, [t(0.07, 0.04, 0.02), t(0.1, 0.03, 0.02), t(0.112, 0.004, 0.012), v(-0.17, 0.002, 0.01), v(-0.115, 0.004, 0.006), v(L.burnerX - 0.025, 0.006, 0)], () => pace(sim.firePower / lhv, 1e-4));
    // flue gas: burner -> around the inner boiler -> smokebox -> chimney
    for (const z of [0.009, -0.009]) {
      this.add(
        C.gas,
        [v(L.burnerX, 0.03, z), v(-0.04, 0.04, z), v(0.12, 0.041, z), v(0.16, 0.048, z * 0.5), v(L.chimneyX, L.blastY + 0.006, 0), v(L.chimneyX, L.chimneyTop, 0)],
        () => (sim.lit ? 0.03 + 0.15 * sim.fireGain : 0),
      );
    }
    // heat passing from the gas into the water
    for (const x of [-0.07, -0.03, 0.01, 0.05, 0.09]) {
      this.add(C.heat, [v(x, 0.041, 0), v(x, 0.05, 0), v(x, L.innerY - 0.004, 0)], () => (sim.heatToWater > 1 ? 0.015 + 0.03 * Math.min(1, sim.heatToWater / 600) : 0), undefined, 0.0009);
    }
  }

  private makeDot(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.beginPath();
    g.arc(16, 16, 13, 0, 2 * Math.PI);
    g.fill();
    return new THREE.CanvasTexture(c);
  }

  private add(color: number, pts: THREE.Vector3[], speed: () => number, pressure?: () => number, radius = 0.0011): void {
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const length = curve.getLength();
    const n = Math.max(3, Math.round(length / 0.011));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: 0.0042, map: this.dot, alphaTest: 0.5, transparent: true, depthWrite: false }));
    points.frustumCulled = false;
    points.renderOrder = 5;
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, Math.round(length / 0.004)), radius, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false }));
    tube.renderOrder = 4;
    this.group.add(tube, points);
    this.paths.push({ curve, points, tube, n, phase: Math.random(), length, speed, pressure });
  }

  update(dt: number): void {
    const p = new THREE.Vector3();
    for (const path of this.paths) {
      const sp = path.speed();
      path.points.visible = sp > 0;
      (path.tube.material as THREE.MeshBasicMaterial).opacity = sp > 0 ? 0.35 : 0.12;
      if (path.pressure) {
        const hue = pressureHue(path.pressure()) / 360;
        (path.points.material as THREE.PointsMaterial).color.setHSL(hue, 0.9, 0.6);
        (path.tube.material as THREE.MeshBasicMaterial).color.setHSL(hue, 0.9, 0.6);
      }
      if (sp <= 0) continue;
      path.phase = (path.phase + (sp * dt) / path.length) % 1;
      const pos = path.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < path.n; i++) {
        path.curve.getPointAt((path.phase + i / path.n) % 1, p);
        pos.setXYZ(i, p.x, p.y, p.z);
      }
      pos.needsUpdate = true;
    }
  }
}
