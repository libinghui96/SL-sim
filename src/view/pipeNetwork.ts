import * as THREE from 'three';
import { RUNNING_GEAR } from '../sim/runningGear';

export type PipePoint = readonly [number, number, number];

// Drawing 6 / manual Fig. 6.2: transverse ball-check chamber and horizontal longitudinal ram; dimensions estimated.
export const PUMP_BODY = {
  length: 0.023,
  radius: 0.0045,
  crossLength: 0.020,
  valveOffset: 0.006,
  ballRadius: 0.0015,
  ballLift: 0.0015,
} as const;

export function pumpPorts(): { inlet: PipePoint; outlet: PipePoint } {
  const { bodyX, axisY, z } = RUNNING_GEAR.pump;
  return {
    inlet: [bodyX, axisY, z - PUMP_BODY.crossLength / 2],
    outlet: [bodyX, axisY, z + PUMP_BODY.crossLength / 2],
  };
}

export interface PipeRun {
  id: string;
  kind: 'steam' | 'superheated' | 'exhaust';
  circuit: 'admission' | 'exhaust' | 'blower';
  points: PipePoint[];
  radius: number;
}

interface PipeLayout {
  innerX0: number; innerX1: number; innerY: number; innerR: number;
  shHeaderX: number; shLen: number; shPitch: number; flueY: number; flueZ: number;
  steamPipeY: number; blowerPipeY: number; blowerPipeZ: number;
  cylZ: number; chimneyX: number; blastY: number;
}

// Manual schematic and drawings 1/17/20 establish topology, not these estimated centreline dimensions.
export function steamNetwork(l: PipeLayout, cylinderX: number, valveY: number) {
  const point = (x: number, y: number, z: number): PipePoint => [x, y, z];
  const top = l.innerY + l.innerR - 0.004;
  const nodes = {
    steamSpace: point(-0.03, top, 0),
    regulator: point(l.innerX0 - 0.01, l.steamPipeY, 0),
    inletHeader: point(l.shHeaderX, l.flueY + l.shPitch, 0),
    outletHeader: point(l.shHeaderX, l.flueY - l.shPitch, 0),
    admissionTee: point(l.shHeaderX + 0.005, 0.026, 0),
    leftChest: point(cylinderX, valveY + 0.00475, -l.cylZ),
    rightChest: point(cylinderX, valveY + 0.00475, l.cylZ),
    leftExhaust: point(cylinderX, 0.008, -l.cylZ + 0.007),
    rightExhaust: point(cylinderX, 0.008, l.cylZ - 0.007),
    exhaustTee: point(l.chimneyX, 0.008, 0),
    blastNozzle: point(l.chimneyX, l.blastY, 0),
    blowerSpace: point(-0.05, top - 0.004, -0.01),
    blowerValve: point(l.innerX0 - 0.018, l.blowerPipeY, -0.01),
    blowerNozzle: point(l.chimneyX - 0.004, l.blastY + 0.004, -0.004),
  };
  const runs: PipeRun[] = [];
  const add = (id: string, kind: PipeRun['kind'], circuit: PipeRun['circuit'], points: PipePoint[], radius = 0.0012) => runs.push({ id, kind, circuit, points, radius });
  add('regulator-inlet', 'steam', 'admission', [nodes.steamSpace, point(-0.085, top, 0), point(-0.085, top + 0.009, 0), point(nodes.regulator[0], top + 0.009, 0), nodes.regulator]);
  add('dry-pipe', 'steam', 'admission', [nodes.regulator, point(l.shHeaderX, l.steamPipeY, 0), nodes.inletHeader]);
  for (const [side, sign] of [['left', -1], ['right', 1]] as const) {
    const z = sign * l.flueZ;
    const back = l.innerX1 - l.shLen - l.shPitch;
    add(`superheater-${side}`, 'superheated', 'admission', [nodes.inletHeader, point(l.shHeaderX, l.flueY + l.shPitch, z), point(back, l.flueY + l.shPitch, z), point(back, l.flueY - l.shPitch, z), point(l.shHeaderX, l.flueY - l.shPitch, z), nodes.outletHeader], 0.0011);
    const chest = side === 'left' ? nodes.leftChest : nodes.rightChest;
    add(`admission-${side}`, 'superheated', 'admission', [nodes.admissionTee, point(nodes.admissionTee[0], 0.026, sign * l.cylZ), point(cylinderX, 0.026, sign * l.cylZ), chest], 0.0015);
    const exhaust = side === 'left' ? nodes.leftExhaust : nodes.rightExhaust;
    add(`exhaust-${side}`, 'exhaust', 'exhaust', [exhaust, point(l.chimneyX, exhaust[1], exhaust[2]), nodes.exhaustTee], 0.0016);
  }
  add('superheater-outlet', 'superheated', 'admission', [nodes.outletHeader, point(nodes.admissionTee[0], l.flueY - l.shPitch, 0), nodes.admissionTee], 0.0015);
  add('blast-pipe', 'exhaust', 'exhaust', [nodes.exhaustTee, nodes.blastNozzle], 0.0022);
  add('blower-inlet', 'steam', 'blower', [nodes.blowerSpace, point(nodes.blowerValve[0], top - 0.004, -0.01), nodes.blowerValve], 0.001);
  add('blower-pipe', 'steam', 'blower', [nodes.blowerValve, point(l.innerX0 - 0.008, l.blowerPipeY, l.blowerPipeZ), point(0.176, l.blowerPipeY, l.blowerPipeZ), point(0.176, 0.046, l.blowerPipeZ), point(nodes.blowerNozzle[0], 0.046, nodes.blowerNozzle[2]), nodes.blowerNozzle], 0.001);
  return { nodes, runs };
}

export function pipeCurve(points: readonly PipePoint[], bend = 0.004): THREE.CurvePath<THREE.Vector3> {
  const pts = points.map(p => new THREE.Vector3(...p));
  const path = new THREE.CurvePath<THREE.Vector3>();
  const line = (a: THREE.Vector3, b: THREE.Vector3) => {
    if (a.distanceTo(b) > 1e-9) path.add(new THREE.LineCurve3(a, b));
  };
  let from = pts[0];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i], a = p.clone().sub(pts[i - 1]), b = pts[i + 1].clone().sub(p);
    const d = Math.min(bend, a.length() / 2, b.length() / 2);
    const start = p.clone().addScaledVector(a.normalize(), -d);
    const end = p.clone().addScaledVector(b.normalize(), d);
    line(from, start);
    if (start.distanceTo(end) > 1e-9) path.add(new THREE.QuadraticBezierCurve3(start, p, end));
    from = end;
  }
  line(from, pts[pts.length - 1]);
  return path;
}