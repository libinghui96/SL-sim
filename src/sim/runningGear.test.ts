import { afterEach, describe, expect, test, vi } from 'vitest';
import { LocoSim } from './loco';
import { d51Params } from './params';
import { RUNNING_GEAR, pumpDisplacement, pumpPose, pumpStrokeLength, sidePhase, wrapAngle } from './runningGear';
import { P_ATM } from './steam';

const TWO_PI = 2 * Math.PI;
const newSim = () => new LocoSim(structuredClone(d51Params));
const { eccentricRadius: r, rodLength: l, axisY: h } = RUNNING_GEAR.pump;
const volumePerRev = d51Params.feed.axlePumpPerRev;
const frontPhase = Math.asin(h / (l - r));
const rearPhase = Math.PI + Math.asin(h / (l + r));
const frontX = -Math.sqrt((l - r) ** 2 - h * h);
const rearX = -Math.sqrt((l + r) ** 2 - h * h);
const stroke = frontX - rearX;
const closureX = (phi: number) => r * Math.cos(phi) - Math.sqrt(l * l - (h + r * Math.sin(phi)) ** 2);

afterEach(() => vi.restoreAllMocks());

describe('D51 four-coupled-axle convention', () => {
  test('main motion and the between-frame pump are on the third of four drivers', () => {
    const drivers: readonly [number, number, number, number] = RUNNING_GEAR.driverX;
    expect(drivers).toEqual([0.1034, 0.0517, 0, -0.0517]);
    expect(RUNNING_GEAR.mainAxle).toBe(2);
    expect(RUNNING_GEAR.pumpAxle).toBe(2);
    expect(RUNNING_GEAR.pump).toEqual({
      eccentricRadius: 0.004,
      rodLength: 0.120,
      bodyX: -0.150,
      axisY: 0.026,
      z: 0.009,
      phaseOffset: 0,
    });
    expect(RUNNING_GEAR.pump.bodyX).toBeLessThan(drivers[RUNNING_GEAR.pumpAxle]);
  });

  test.each([0, -0, -Number.EPSILON, Math.PI / 2, -Math.PI / 2, TWO_PI, -TWO_PI, 31 * Math.PI])('wraps angle %s into [0, 2π)', (phi) => {
    const phase = wrapAngle(phi);
    expect(phase).toBeGreaterThanOrEqual(0);
    expect(phase).toBeLessThan(TWO_PI);
    expect(Object.is(phase, -0)).toBe(false);
    expect(Math.sin(phase)).toBeCloseTo(Math.sin(phi), 12);
    expect(Math.cos(phase)).toBeCloseTo(Math.cos(phi), 12);
  });

  test.each([1, -1])('same-side coupling rods and main rod close throughout a turn, direction %s', (direction) => {
    const sim = newSim();
    for (let degree = 0; degree <= 360; degree++) {
      const phi = (direction * degree * Math.PI) / 180;
      // Do not wrap sidePhase: engine physics retains the original unwrapped convention.
      expect(sidePhase(phi, 0)).toBeCloseTo(phi, 12);
      expect(sidePhase(phi, 1)).toBe(phi + Math.PI / 2);
      for (const side of [0, 1]) {
        const pins = RUNNING_GEAR.driverX.map((x) => {
          const phase = sidePhase(phi, side);
          return { x: x + sim.gear.crankRadius * Math.cos(phase), y: -sim.gear.crankRadius * Math.sin(phase) };
        });
        for (let axle = 1; axle < pins.length; axle++) {
          expect(pins[axle].y).toBe(pins[0].y);
          expect(Math.hypot(pins[axle].x - pins[axle - 1].x, pins[axle].y - pins[axle - 1].y)).toBeCloseTo(
            RUNNING_GEAR.driverX[axle - 1] - RUNNING_GEAR.driverX[axle], 12,
          );
        }
        const pose = sim.gear.solve(sidePhase(phi, side), direction);
        const mainPin = pins[RUNNING_GEAR.mainAxle];
        expect(mainPin.x).toBeCloseTo(pose.crankPin.x, 12);
        expect(mainPin.y).toBeCloseTo(pose.crankPin.y, 12);
        expect(Math.hypot(mainPin.x - pose.crosshead.x, mainPin.y - pose.crosshead.y)).toBeCloseTo(sim.params.gear.conRod, 12);
      }
    }
  });

  test('engine reset, piston work and valve lookup share left/right quartering', () => {
    const sim = newSim();
    const piston = vi.spyOn(sim.gear, 'piston');
    const derivative = vi.spyOn(sim.gear, 'dPiston');
    const valve = vi.spyOn(sim.gear, 'valveAt');
    const phi = -3 * Math.PI + 0.37;
    const phases = [[sidePhase(phi, 0)], [sidePhase(phi, 1)]];
    sim.engine.reset(sim.params.ambientT, phi);
    expect(piston.mock.calls).toEqual(phases);
    piston.mockClear();
    sim.engine.step(50e-6, phi, P_ATM, sim.params.ambientT, 0, 0, false);
    expect(piston.mock.calls).toEqual(phases);
    expect(derivative.mock.calls).toEqual(phases);
    expect(valve.mock.calls).toEqual(phases);
  });
});

describe('rear-mounted axle pump geometry', () => {
  const centreRod = Math.sqrt(l * l - h * h);
  test.each([
    [0, r, 0, r - centreRod, r * h / centreRod],
    [Math.PI / 2, 0, -r, -Math.sqrt(l * l - (h + r) ** 2), -r],
    [Math.PI, -r, 0, -r - centreRod, -r * h / centreRod],
    [3 * Math.PI / 2, 0, r, -Math.sqrt(l * l - (h - r) ** 2), r],
  ])('cardinal phase %s has the expected eccentric and offset ram', (phase, x, y, ramX, velocity) => {
    const pose = pumpPose(phase, 1);
    expect(pose.phase).toBe(phase);
    expect(pose.eccentric.x).toBeCloseTo(x, 12);
    expect(pose.eccentric.y).toBeCloseTo(y, 12);
    expect(pose.ram.x).toBeCloseTo(ramX, 12);
    expect(pose.ram.y).toBe(h);
    expect(pose.velocity).toBeCloseTo(velocity, 12);
    expect(pose.strokeFraction).toBeCloseTo((frontX - ramX) / stroke, 12);
    expect(pose.delivering).toBe(velocity < 0);
  });

  test('offset dead centres set the true stroke and preserve the estimated 0.1 mL capacity', () => {
    expect(frontPhase).toBeCloseTo(0.2260583712438492, 14);
    expect(rearPhase).toBeCloseTo(3.3528376872310974, 14);
    expect(pumpPose(frontPhase, 1).ram.x).toBeCloseTo(-0.11304866208850062, 14);
    expect(pumpPose(rearPhase, 1).ram.x).toBeCloseTo(-0.12124355652982141, 14);
    expect(pumpPose(frontPhase, 1).strokeFraction).toBe(0);
    expect(pumpPose(rearPhase, 1).strokeFraction).toBe(1);
    expect(pumpStrokeLength()).toBeCloseTo(0.008194894441320794, 14);
    expect(pumpStrokeLength()).toBeCloseTo(stroke, 14);
    expect(pumpStrokeLength()).toBeGreaterThan(2 * r);
    expect(rearPhase - frontPhase).toBeLessThan(Math.PI);
    expect(volumePerRev).toBe(0.1e-6);
    const boreRadius = Math.sqrt(volumePerRev / (Math.PI * pumpStrokeLength()));
    expect(boreRadius).toBeCloseTo(Math.sqrt(volumePerRev / (Math.PI * stroke)), 14);
    expect(Math.PI * boreRadius ** 2 * stroke).toBeCloseTo(volumePerRev, 18);
    for (const [phase, x, isFront] of [[frontPhase, frontX, true], [rearPhase, rearX, false]] as const) {
      for (const delta of [-1e-4, 1e-4]) {
        const nearby = pumpPose(phase + delta, 1);
        if (isFront) expect(nearby.ram.x).toBeLessThan(x);
        else expect(nearby.ram.x).toBeGreaterThan(x);
        expect(nearby.delivering).toBe(isFront ? delta > 0 : delta < 0);
      }
    }
  });

  test('the full body and moving linkage clear the fourth axle and the central burner', () => {
    const { bodyX, axisY, z } = RUNNING_GEAR.pump;
    const fourthX = RUNNING_GEAR.driverX[3];
    const shaftRadius = 0.0028;
    expect(Math.abs(z) + 0.001).toBeLessThan(0.0155);
    expect(Math.abs(z) - 0.001).toBeGreaterThan(0.0048);
    expect(bodyX + 0.023 / 2).toBeLessThan(-0.102 - 0.0048);
    expect(bodyX + 0.023 / 2).toBeLessThan(fourthX - shaftRadius);
    expect(axisY - 0.0045).toBeGreaterThan(shaftRadius);
    for (let degree = 0; degree < 360; degree++) {
      const { ram, eccentric } = pumpPose(degree * Math.PI / 180, 1);
      expect(ram.y).toBe(axisY);
      expect(ram.x).toBeGreaterThan(bodyX + 0.023 / 2);
      expect(ram.x).toBeLessThan(fourthX);
      const dx = eccentric.x - ram.x, dy = eccentric.y - ram.y;
      const t = Math.max(0, Math.min(1, ((fourthX - ram.x) * dx - ram.y * dy) / (l * l)));
      expect(Math.hypot(ram.x + t * dx - fourthX, ram.y + t * dy)).toBeGreaterThan(shaftRadius + 0.001);
    }
  });

  test.each([1, -1])('eccentric radius, exact rod length and velocity hold for a full turn, direction %s', (direction) => {
    const omega = direction * 7;
    for (let degree = 0; degree <= 360; degree++) {
      const phi = (direction * degree * Math.PI) / 180;
      const pose = pumpPose(phi, omega);
      expect(Math.hypot(pose.eccentric.x - RUNNING_GEAR.driverX[RUNNING_GEAR.pumpAxle], pose.eccentric.y)).toBeCloseTo(r, 12);
      expect(Math.hypot(pose.eccentric.x - pose.ram.x, pose.eccentric.y - pose.ram.y)).toBeCloseTo(l, 12);
      expect(pose.ram.x).toBeLessThan(pose.eccentric.x);
      expect(pose.ram.x).toBeGreaterThan(RUNNING_GEAR.pump.bodyX);
      expect(pose.ram.y).toBe(h);
      expect(pose.ram.x).toBeGreaterThanOrEqual(rearX - 1e-15);
      expect(pose.ram.x).toBeLessThanOrEqual(frontX + 1e-15);
      expect(pose.strokeFraction).toBeGreaterThanOrEqual(0);
      expect(pose.strokeFraction).toBeLessThanOrEqual(1);
      const step = 1e-6;
      const numericVelocity = omega * (closureX(phi + step) - closureX(phi - step)) / (2 * step);
      expect(pose.velocity).toBeCloseTo(numericVelocity, 9);
      expect(pose.delivering).toBe(pose.velocity < 0);
      const nextTurn = pumpPose(phi + TWO_PI, omega);
      expect(nextTurn.ram.x).toBeCloseTo(pose.ram.x, 12);
      expect(nextTurn.eccentric.y).toBeCloseTo(pose.eccentric.y, 12);
    }
  });

  test('no delivery at rest or either dead centre; reversing swaps suction and delivery', () => {
    for (let degree = 0; degree < 360; degree++) {
      const phi = degree * Math.PI / 180;
      const stationary = pumpPose(phi, 0);
      expect(stationary.velocity).toBe(0);
      expect(stationary.delivering).toBe(false);
      expect(pumpPose(phi, -4).velocity).toBeCloseTo(-pumpPose(phi, 4).velocity, 12);
    }
    for (const turns of [-100000, -7, -1, 0, 1, 7, 100000]) {
      for (const phase of [frontPhase, rearPhase]) {
        for (const omega of [-4, 4]) {
          const pose = pumpPose(phase + turns * TWO_PI, omega);
          expect(pose.velocity).toBe(0);
          expect(pose.delivering).toBe(false);
          expect(pose.strokeFraction).toBe(phase === frontPhase ? 0 : 1);
        }
      }
    }
    expect(pumpPose(0, 4).velocity).toBeGreaterThan(0);
    expect(pumpPose(Math.PI, 4).velocity).toBeLessThan(0);
    expect(pumpPose(Math.PI / 2, 4).delivering).toBe(true);
    expect(pumpPose(Math.PI / 2, -4).delivering).toBe(false);
    expect(pumpPose(3 * Math.PI / 2, 4).delivering).toBe(false);
    expect(pumpPose(3 * Math.PI / 2, -4).delivering).toBe(true);
  });
});

describe('phase-integrated pump delivery', () => {
  test('zero traversal and zero pump capacity deliver no water', () => {
    for (const phi of [-17, 0, 0.5, Math.PI, 100]) expect(pumpDisplacement(phi, phi, volumePerRev)).toBe(0);
    expect(pumpDisplacement(-2, 25, 0)).toBe(0);
    expect(pumpDisplacement(-2, 25, -volumePerRev)).toBe(0);
  });

  test.each([1, -1])('full turns deliver one stroke per revolution from any phase, direction %s', (direction) => {
    for (const from of [-17 * Math.PI, -0.4, 0, 0.7, Math.PI, frontPhase, rearPhase, 7 * Math.PI]) {
      for (const turns of [1, 2, 7, 100000]) {
        const delivered = pumpDisplacement(from, from + direction * turns * TWO_PI, volumePerRev);
        expect(delivered / volumePerRev).toBeCloseTo(turns, 8);
      }
    }
  });

  test.each([1, -1])('one unequal-angle compression stroke and one dry suction stroke, direction %s', (direction) => {
    const rear = direction > 0 ? rearPhase : rearPhase - TWO_PI;
    expect(pumpDisplacement(frontPhase, rear, volumePerRev) / volumePerRev).toBeCloseTo(1, 12);
    expect(pumpDisplacement(rear, frontPhase + direction * TWO_PI, volumePerRev) / volumePerRev).toBeCloseTo(0, 12);
    let deliveryStarts = 0;
    let previouslyDelivering = false;
    let volume = 0;
    for (let i = 0; i < 360; i++) {
      const from = frontPhase + direction * i * TWO_PI / 360;
      const to = frontPhase + direction * (i + 1) * TWO_PI / 360;
      const delivering = pumpPose((from + to) / 2, direction).delivering;
      if (delivering && !previouslyDelivering) deliveryStarts++;
      previouslyDelivering = delivering;
      const increment = pumpDisplacement(from, to, volumePerRev);
      expect(increment).toBeGreaterThanOrEqual(0);
      if (!delivering && pumpPose(from, direction).velocity > 0 && pumpPose(to, direction).velocity > 0) expect(increment).toBe(0);
      volume += increment;
    }
    expect(deliveryStarts).toBe(1);
    expect(volume / volumePerRev).toBeCloseTo(1, 12);
  });

  test.each([1, -1])('exact partial strokes across both dead centres, direction %s', (direction) => {
    const quarterPhase = direction > 0 ? Math.PI / 2 : -Math.PI / 2;
    const laterPhase = direction > 0 ? 3 * Math.PI / 2 : -3 * Math.PI / 2;
    const first = pumpDisplacement(frontPhase, quarterPhase, volumePerRev) / volumePerRev;
    expect(first).toBeCloseTo((frontX - closureX(quarterPhase)) / stroke, 12);
    expect(first).not.toBeCloseTo(0.5, 3);
    expect(pumpDisplacement(quarterPhase, laterPhase, volumePerRev) / volumePerRev).toBeCloseTo((closureX(quarterPhase) - rearX) / stroke, 12);
    expect(pumpDisplacement(laterPhase, quarterPhase + direction * TWO_PI, volumePerRev) / volumePerRev).toBeCloseTo(first, 12);
    for (const turns of [-7, -1, 0, 3]) {
      for (const epsilon of [1e-7, 1e-4, 0.1]) {
        for (const [phase, x] of [[frontPhase, frontX], [rearPhase, rearX]]) {
          const from = phase - direction * epsilon + turns * TWO_PI;
          const to = phase + direction * epsilon + turns * TWO_PI;
          const expected = phase === frontPhase ? x - closureX(to) : closureX(from) - x;
          expect(pumpDisplacement(from, to, volumePerRev) / volumePerRev).toBeCloseTo(expected / stroke, 12);
        }
      }
    }
  });

  test.each([1, -1])('multi-turn residuals agree with independent closure quadrature, direction %s', (direction) => {
    const from = -0.39;
    const distance = 4.375 * TWO_PI;
    const n = 8192;
    const step = distance / n;
    const epsilon = 1e-5;
    let travel = 0;
    for (let i = 0; i < n; i++) {
      const phase = from + direction * (i + 0.5) * step;
      const derivative = (closureX(phase + epsilon) - closureX(phase - epsilon)) / (2 * epsilon);
      travel += Math.max(0, -direction * derivative) * step;
    }
    expect(pumpDisplacement(from, from + direction * distance, volumePerRev) / volumePerRev).toBeCloseTo(travel / stroke, 5);
  });

  test('a reversal returns only the distance that actually compresses the ram', () => {
    const from = frontPhase + 0.2, to = rearPhase - 0.3;
    const compressed = (closureX(from) - closureX(to)) / stroke;
    expect(pumpDisplacement(from, to, volumePerRev) / volumePerRev).toBeCloseTo(compressed, 12);
    expect(pumpDisplacement(to, from, volumePerRev)).toBe(0);
    const a = rearPhase + 0.2, b = frontPhase + TWO_PI - 0.2;
    expect(pumpDisplacement(a, b, volumePerRev)).toBe(0);
    expect(pumpDisplacement(b, a, volumePerRev) / volumePerRev).toBeCloseTo((closureX(b) - closureX(a)) / stroke, 12);
  });

  test('subdivision is additive, including reversals and negative angles', () => {
    const path = [frontPhase, rearPhase, frontPhase - TWO_PI, 0, -Number.EPSILON, 0.4, 1.3, 1.9, 3.8, 2.1, -0.3, -4.9, 9.3];
    for (let j = 1; j < path.length; j++) {
      const from = path[j - 1];
      const to = path[j];
      let sum = 0;
      for (let i = 0; i < 100; i++) {
        const a = from + (to - from) * i / 100;
        const b = from + (to - from) * (i + 1) / 100;
        const increment = pumpDisplacement(a, b, volumePerRev);
        expect(increment).toBeGreaterThanOrEqual(0);
        sum += increment;
      }
      expect(sum / volumePerRev).toBeCloseTo(pumpDisplacement(from, to, volumePerRev) / volumePerRev, 12);
    }
  });
});

describe('locomotive pump integration and reset', () => {
  test.each([[1, true], [-1, true], [1, false], [-1, false]] as const)('feed uses actual compression travel: direction %s, compression %s', (direction, compression) => {
    const sim = newSim();
    sim.mode = 'rollers';
    sim.phi = direction * (compression ? 0.4 : Math.PI + 0.4);
    sim.omega = direction * 20;
    sim.controls.bypass = 0.35;
    // Isolate pump delivery from cylinder thermodynamics; retain the real wheel integrator.
    vi.spyOn(sim.engine, 'step').mockImplementation(() => {});
    const from = sim.phi;
    const tenderBefore = sim.tenderWater;
    sim.advance(0.001);
    const pumped = pumpDisplacement(from, sim.phi, sim.params.feed.axlePumpPerRev);
    const fed = pumped * (1 - sim.controls.bypass);
    expect(sim.waterFed / (volumePerRev * 998)).toBeCloseTo(fed / volumePerRev, 12);
    expect((tenderBefore - sim.tenderWater) / volumePerRev).toBeCloseTo(fed / volumePerRev, 9);
    expect(sim.pumpFlow / (volumePerRev * 998)).toBeCloseTo(pumped / volumePerRev * 2, 12);
    if (compression) expect(pumped).toBeGreaterThan(0);
    else expect(pumped).toBe(0);
  });

  test('bypass and hand pump retain their feed behavior; an empty tender cannot deliver', () => {
    const sim = newSim();
    sim.mode = 'rollers';
    sim.phi = frontPhase + 0.4;
    sim.omega = 20;
    vi.spyOn(sim.engine, 'step').mockImplementation(() => {});
    sim.advance(0.001);
    expect(sim.pumpFlow).toBeGreaterThan(0);
    expect(sim.waterFed).toBe(0); // Default bypass is fully open.
    sim.handPump();
    sim.advance(0.001);
    expect(sim.waterFed).toBeCloseTo(sim.params.feed.handPumpPerStroke * 998, 12);
    sim.tenderWater = 0;
    sim.controls.bypass = 0;
    const fedBefore = sim.waterFed;
    sim.handPump();
    sim.advance(0.001);
    expect(sim.waterFed).toBe(fedBefore);
    expect(sim.tenderWater).toBe(0);
  });

  test.each(['resetCold', 'resetHot'] as const)('%s discards fractional time, pending steam/exhaust/drains, axle water and hand strokes', (reset) => {
    const dirty = newSim();
    dirty.resetHot();
    dirty.mode = 'rollers';
    dirty.omega = 20;
    dirty.controls.regulator = 0.3;
    // Seed every flow accumulator in two engine steps, without reaching a boiler step.
    const step = vi.spyOn(dirty.engine, 'step').mockImplementation(() => {
      dirty.engine.steamIn = 1e-8;
      dirty.engine.exhaustOut = 2e-8;
      dirty.engine.drainOut = 3e-8;
    });
    dirty.advance(0.00006);
    dirty.handPump();
    expect(dirty.time).toBeCloseTo(0.0001, 12);
    expect(dirty.waterFed).toBe(0);
    step.mockRestore();

    const clean = newSim();
    clean.mode = dirty.mode;
    clean.phi = dirty.phi; // Resets deliberately preserve the physical crank orientation.
    dirty[reset]();
    clean[reset]();
    dirty.controls.bypass = clean.controls.bypass = 0;
    const snapshot = (sim: LocoSim) => ({
      time: sim.time, phi: sim.phi, omega: sim.omega, tender: sim.tenderWater,
      steamUsed: sim.steamUsed, waterFed: sim.waterFed,
      steam: sim.steamFlow, exhaust: sim.exhaustFlow, drains: sim.drainFlow,
      feed: sim.feedFlow, pump: sim.pumpFlow,
      boilerMass: sim.boiler.M, boilerTemperature: sim.boiler.T,
      cylinderMass: [...sim.engine.m], cylinderEnergy: [...sim.engine.U],
    });
    expect(snapshot(dirty)).toEqual(snapshot(clean));
    for (const dt of [0.00001, 0.00099, 0.001, 0.005]) {
      dirty.advance(dt);
      clean.advance(dt);
      expect(snapshot(dirty)).toEqual(snapshot(clean));
    }
    expect(dirty.waterFed).toBe(0);
  });
});