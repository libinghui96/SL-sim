import * as THREE from 'three';
import { describe, expect, test } from 'vitest';
import { TRANSLATIONS } from '../i18n';
import { LocoSim } from '../sim/loco';
import { d51Params } from '../sim/params';
import { RUNNING_GEAR, pumpPose, pumpStrokeLength, sidePhase } from '../sim/runningGear';
import { LocoModel } from './locoModel';
import { phaseValues } from './phaseBoard';
import { PUMP_BODY, pipeCurve, pumpPorts } from './pipeNetwork';

const sim = new LocoSim(structuredClone(d51Params));
const model = new LocoModel(sim, sim.params.track.radius);
const mesh = (name: string) => model.root.getObjectByName(name) as THREE.Mesh;
const near = (a: THREE.Vector3, b: THREE.Vector3) => expect(a.distanceTo(b)).toBeLessThan(1e-9);
const endpoint = (name: string, sign: -1 | 1) => {
  const object = mesh(name);
  object.updateMatrix();
  return new THREE.Vector3(sign / 2, 0, 0).applyMatrix4(object.matrix);
};

describe('rendered mechanism shares physical phase', () => {
  test('both sides, all wheels and links agree with the phase monitor across forward/neutral/reverse', () => {
    for (const gear of [-1, 0, 1]) {
      sim.controls.reverser = gear;
      for (let degree = 0; degree < 360; degree += 15) {
        sim.phi = degree * Math.PI / 180;
        model.update(0);
        const board = phaseValues(sim, true);
        for (const side of [0, 1]) {
          const phase = sidePhase(sim.phi, side);
          const pose = board.sides[side].pose;
          RUNNING_GEAR.driverX.forEach((x, axle) => {
            const wheel = mesh(`driver-${side}-${axle}`);
            expect(wheel.position.x).toBe(x);
            expect(wheel.rotation.z).toBe(-phase);
            const pin = new THREE.Vector3(sim.gear.crankRadius, 0, 0).applyEuler(wheel.rotation).add(wheel.position);
            expect(pin.x).toBeCloseTo(x + pose.crankPin.x, 12);
            expect(pin.y).toBeCloseTo(pose.crankPin.y, 12);
          });
          for (let axle = 0; axle < 3; axle++) {
            const rod = mesh(`coupling-${side}-${axle}`);
            expect(rod.scale.x).toBeCloseTo(RUNNING_GEAR.driverX[axle] - RUNNING_GEAR.driverX[axle + 1], 12);
            near(endpoint(rod.name, -1), new THREE.Vector3(RUNNING_GEAR.driverX[axle] + pose.crankPin.x, pose.crankPin.y, rod.position.z));
          }
          const rod = mesh(`motion-${side}-mainRod`);
          expect(rod.scale.x).toBeCloseTo(sim.params.gear.conRod, 12);
          near(endpoint(rod.name, -1), new THREE.Vector3(pose.crankPin.x, pose.crankPin.y, rod.position.z));
          near(endpoint(rod.name, 1), new THREE.Vector3(pose.crosshead.x, pose.crosshead.y, rod.position.z));
          const radiusRod = mesh(`motion-${side}-radiusRod`);
          near(endpoint(radiusRod.name, 1), new THREE.Vector3(pose.leverTop.x, pose.leverTop.y, radiusRod.position.z));
          const spindle = mesh(`motion-${side}-spindle`);
          near(endpoint(spindle.name, -1), new THREE.Vector3(pose.leverMid.x, pose.leverMid.y, spindle.position.z));
          expect(mesh(`piston-${side}`).position.x).toBeCloseTo(model.cylX0 + pose.piston, 12);
          expect(mesh(`valve-${side}`).position.x).toBeCloseTo(model.cylX0 + pose.valve, 12);
          const link = mesh(`expansion-link-${side}`);
          const die = mesh(`die-block-${side}`);
          const local = new THREE.Vector3(die.position.x - link.position.x, die.position.y - link.position.y, 0).applyAxisAngle(new THREE.Vector3(0, 0, 1), -link.rotation.z);
          expect(Math.hypot(local.x - sim.params.gear.radiusRod, local.y)).toBeCloseTo(sim.params.gear.radiusRod, 12);
        }
      }
    }
  });

  test('rendered pump follows exact offset closure, shares dashboard pose, and fits its capacity', () => {
    const pp = RUNNING_GEAR.pump;
    for (const omega of [-12, 0, 12]) {
      sim.omega = omega;
      for (let degree = 0; degree < 360; degree += 5) {
        sim.phi = degree * Math.PI / 180;
        model.update(0.01);
        const pose = pumpPose(sim.phi, omega);
        const board = phaseValues(sim, false);
        expect(board.pump).toEqual(pose);
        near(mesh('pump-eccentric').position, new THREE.Vector3(pose.eccentric.x, pose.eccentric.y, pp.z));
        expect(mesh('pump-rod').scale.x).toBeCloseTo(pp.rodLength, 12);
        near(endpoint('pump-rod', -1), new THREE.Vector3(pose.eccentric.x, pose.eccentric.y, pp.z));
        near(endpoint('pump-rod', 1), new THREE.Vector3(pose.ram.x, pose.ram.y, pp.z));
        near(endpoint('pump-ram', 1), new THREE.Vector3(pose.ram.x, pose.ram.y, pp.z));
        const geometry = mesh('pump-ram').geometry as THREE.CylinderGeometry;
        const radius = geometry.parameters.radiusTop;
        expect(Math.PI * radius ** 2 * pumpStrokeLength()).toBeCloseTo(sim.params.feed.axlePumpPerRev, 16);
      }
    }
  });
});

describe('physical pipe and label integration', () => {
  test('cylinder passages cross longitudinally in separate planes, without joining each other', () => {
    for (const side of [0, 1]) {
      const paths = [0, 1].map(end => (mesh(`cylinder-passage-${side}-${end}`).geometry as THREE.TubeGeometry).parameters.path);
      const frontPort = paths[0].getPointAt(0), frontEnd = paths[0].getPointAt(1);
      const rearPort = paths[1].getPointAt(0), rearEnd = paths[1].getPointAt(1);
      expect(frontPort.x).toBeLessThan(model.cylX0);
      expect(frontEnd.x).toBeGreaterThan(model.cylX0);
      expect(rearPort.x).toBeGreaterThan(model.cylX0);
      expect(rearEnd.x).toBeLessThan(model.cylX0);
      expect(Math.abs(frontPort.z - rearPort.z)).toBeGreaterThan(0.0016);
    }
  });

  test('pump cylinder is longitudinal and horizontal; valve chamber is transverse (figures 6 / 6.2)', () => {
    const cylinder = mesh('pump-cylinder');
    const chamber = mesh('pump-valve-chamber');
    const bounds = (object: THREE.Mesh) => {
      object.geometry.computeBoundingBox();
      return object.geometry.boundingBox!.getSize(new THREE.Vector3());
    };
    const bodySize = bounds(cylinder), chamberSize = bounds(chamber);
    expect(bodySize.x).toBeCloseTo(PUMP_BODY.length, 8);
    expect(bodySize.x).toBeGreaterThan(bodySize.y);
    expect(bodySize.x).toBeGreaterThan(bodySize.z);
    expect(chamberSize.z).toBeCloseTo(PUMP_BODY.crossLength, 8);
    expect(chamberSize.z).toBeGreaterThan(chamberSize.x);
    expect(chamberSize.z).toBeGreaterThan(chamberSize.y);
    expect(cylinder.quaternion.angleTo(new THREE.Quaternion())).toBe(0);
    expect(chamber.quaternion.angleTo(new THREE.Quaternion())).toBe(0);
    for (const phi of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2]) {
      sim.phi = phi;
      model.update(0);
      const start = endpoint('pump-ram', -1), end = endpoint('pump-ram', 1);
      expect(start.x).not.toBe(end.x);
      expect(start.y).toBeCloseTo(end.y, 12);
      expect(start.z).toBe(end.z);
    }
  });

  test('pump ports and steel balls share the transverse chamber in drawing 6', () => {
    const pp = RUNNING_GEAR.pump;
    const ports = pumpPorts();
    const chamber = mesh('pump-valve-chamber');
    const length = (chamber.geometry as THREE.CylinderGeometry).parameters.height;
    near(new THREE.Vector3(...ports.inlet), chamber.position.clone().add(new THREE.Vector3(0, 0, -length / 2)));
    near(new THREE.Vector3(...ports.outlet), chamber.position.clone().add(new THREE.Vector3(0, 0, length / 2)));
    for (const omega of [-4, 0, 4]) {
      sim.omega = omega;
      for (const phi of [Math.PI / 2, 3 * Math.PI / 2]) {
        sim.phi = phi;
        model.update(0.01);
        const pose = pumpPose(phi, omega);
        for (const [name, sign, open] of [
          ['pump-inlet-ball', -1, pose.velocity > 0],
          ['pump-outlet-ball', 1, pose.velocity < 0],
        ] as const) {
          const ball = mesh(name);
          expect(ball.position.x).toBe(pp.bodyX);
          expect(ball.position.y).toBe(pp.axisY);
          expect(ball.position.z).toBeCloseTo(pp.z + sign * PUMP_BODY.valveOffset + (open ? PUMP_BODY.ballLift : 0), 12);
          expect(Math.abs(ball.position.z - pp.z) + PUMP_BODY.ballRadius).toBeLessThan(length / 2);
        }
      }
    }
    model.update(0);
    expect(mesh('pump-inlet-ball').position.z).toBe(pp.z - PUMP_BODY.valveOffset);
    expect(mesh('pump-outlet-ball').position.z).toBe(pp.z + PUMP_BODY.valveOffset);
  });

  test('each physical tube uses the same shared curve as the overlay, without stale open stubs', () => {
    for (const run of model.pipework.runs) {
      const object = mesh(run.id);
      expect(object).toBeDefined();
      const curve = (object.geometry as THREE.TubeGeometry).parameters.path;
      const shared = pipeCurve(run.points);
      for (let i = 0; i <= 20; i++) near(curve.getPointAt(i / 20), shared.getPointAt(i / 20));
    }
    model.setMode('xray', false);
    model.setExplode(1);
    expect(mesh('blast-pipe').parent!.visible).toBe(false);
    model.setExplode(0);
    expect(mesh('blast-pipe').parent!.visible).toBe(true);
  });

  test('all structural and motion labels have English and Japanese translations', () => {
    for (const label of model.labels) expect(Object.hasOwn(TRANSLATIONS, label.text), label.text).toBe(true);
  });
});