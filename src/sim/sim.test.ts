import { describe, expect, test } from 'vitest';
import { LocoSim } from './loco';
import { d51Params } from './params';
import { KGF_CM2, P_ATM, orificeFlow, pSat, sat, tSat } from './steam';

const newSim = () => new LocoSim(structuredClone(d51Params));
const kgf = (sim: LocoSim) => sim.boiler.gaugePressure / KGF_CM2;

describe('steam properties', () => {
  test('saturation line matches IF97 verification values', () => {
    expect(pSat(300)).toBeCloseTo(3536.58941, 3);
    expect(pSat(500) / 1e6).toBeCloseTo(2.63889776, 6);
    expect(tSat(0.1e6)).toBeCloseTo(372.755919, 5);
    expect(tSat(1e6)).toBeCloseTo(453.035632, 5);
  });

  test('interpolated saturated properties match steam tables between nodes', () => {
    const a = sat(273.15 + 150);
    expect(a.vg).toBeCloseTo(0.3928, 3);
    expect(a.hf / 1e3).toBeCloseTo(632.2, 0);
    expect(a.hg / 1e3).toBeCloseTo(2746.5, 0);
    const b = sat(273.15 + 130);
    expect(b.vg).toBeCloseTo(0.6685, 3);
    expect(b.hf / 1e3).toBeCloseTo(546.3, 0);
    expect(b.hg / 1e3).toBeCloseTo(2720.5, 0);
  });

  test('orifice flow chokes and vanishes smoothly at equal pressure', () => {
    expect(orificeFlow(1e-6, 5e5, 425, P_ATM)).toBeCloseTo(7.534e-4, 6);
    expect(orificeFlow(1e-6, 5e5, 425, 1e5)).toBe(orificeFlow(1e-6, 5e5, 425, 2e5));
    expect(orificeFlow(1e-6, 5e5, 425, 5e5)).toBe(0);
    let last = Infinity;
    for (let pr = 0.6; pr < 1; pr += 0.01) {
      const f = orificeFlow(1e-6, 5e5, 425, 5e5 * pr);
      expect(f).toBeLessThan(last);
      last = f;
    }
  });
});

describe('Walschaerts valve gear', () => {
  const sim = newSim();
  const gear = sim.gear;
  const g = sim.params.gear;
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

  test('linkage closes at every crank angle and reverser position', () => {
    for (const u of [-1, -0.4, 0, 0.7, 1]) {
      for (let d = 0; d < 360; d += 7) {
        const p = gear.solve((d * Math.PI) / 180, u);
        expect(dist(p.linkTail, p.eccPin)).toBeCloseTo(gear.eccRod, 9);
        expect(dist(p.linkTail, p.linkPivot)).toBeCloseTo(g.linkTail, 9);
        expect(dist(p.leverTop, p.dieBlock)).toBeCloseTo(g.radiusRod, 9);
        expect(dist(p.leverBottom, p.dropPin)).toBeCloseTo(g.unionLink, 9);
        expect(dist(p.crankPin, p.crosshead)).toBeCloseTo(g.conRod, 9);
      }
    }
  });

  test('mid gear gives only lap + lead travel', () => {
    const e = gear.events(0);
    expect(e.travel).toBeCloseTo((sim.params.engine.stroke * g.leverUpper) / (g.leverUpper + g.leverLower), 4);
    expect(e.front.cutoff).toBeLessThan(15);
  });

  test('lead is nearly independent of the reverser, cutoff shortens when notched up', () => {
    const full = gear.events(1);
    const half = gear.events(0.5);
    const back = gear.events(-1);
    for (const e of [full, half, back]) {
      expect(e.front.lead).toBeGreaterThan(0);
      expect(e.back.lead).toBeGreaterThan(0);
      expect(Math.abs(e.front.lead - full.front.lead)).toBeLessThan(0.15e-3);
    }
    expect(full.front.cutoff).toBeGreaterThan(70);
    expect(full.front.cutoff).toBeLessThan(92);
    expect(half.front.cutoff).toBeLessThan(full.front.cutoff - 15);
    expect(back.back.cutoff).toBeGreaterThan(70);
  });
});

describe('boiler', () => {
  test('closed boiler conserves energy when heated', () => {
    const sim = newSim();
    const b = sim.boiler;
    const p = sim.params.boiler;
    const m = b.M;
    b.apply(100e3, 0, 0, 0, 293.15);
    expect(b.M).toBe(m);
    // nearly all of the heat goes into liquid water and metal
    const expected = 100e3 / (m * 4186 + p.metalHeatCapacity);
    expect(b.T - 293.15).toBeGreaterThan(expected * 0.95);
    expect(b.T - 293.15).toBeLessThan(expected * 1.03);
    expect(b.glass).toBeGreaterThan(0.5);
  });
});

describe('locomotive, against the Aster D51 manual', () => {
  test('a cold, unlit engine stays cold and does not move', () => {
    const sim = newSim();
    sim.params.track.gradePermil = 5;
    sim.advance(120);
    expect(sim.distance).toBe(0);
    expect(sim.engine.wallT[0]).toBeCloseTo(293.15, 1);
    expect(sim.boiler.T).toBeCloseTo(293.15, 1);
    for (const P of sim.engine.P) expect(P).toBeCloseTo(P_ATM, -2);
  });

  test('raising steam: pressure appears after 2-5 min with the fan, safety valve lifts at 4 kgf/cm2', () => {
    const sim = newSim();
    sim.controls.fuelValve = 0.5;
    sim.controls.fan = true;
    sim.ignite();
    let tRise = 0;
    let tSafety = 0;
    for (let t = 1; t <= 900 && !tSafety; t++) {
      sim.advance(1);
      if (!tRise && kgf(sim) > 0.02) tRise = t;
      if (sim.controls.fan && kgf(sim) > 1.75) {
        sim.controls.fan = false;
        sim.controls.blower = 0.3;
      }
      if (sim.safetyOpen) tSafety = t;
    }
    expect(tRise).toBeGreaterThan(120);
    expect(tRise).toBeLessThan(300);
    expect(tSafety).toBeGreaterThan(tRise);
    expect(kgf(sim)).toBeGreaterThan(3.9);
    expect(kgf(sim)).toBeLessThan(4.2);
  });

  test('fire dies down without draft', () => {
    const sim = newSim();
    sim.controls.fuelValve = 0.5;
    sim.ignite();
    sim.advance(1);
    const weak = sim.fireGain;
    sim.controls.fan = true;
    sim.advance(1);
    expect(sim.fireGain).toBeGreaterThan(2 * weak);
  });

  test('runs in the direction of the reverser on rollers', () => {
    for (const dir of [1, -1]) {
      const sim = newSim();
      sim.resetHot();
      sim.mode = 'rollers';
      sim.controls.reverser = dir;
      sim.controls.regulator = 0.3;
      sim.advance(5);
      expect(sim.omega * dir).toBeGreaterThan(10);
      expect(sim.v).toBe(0);
    }
  });

  test('hauling a train at ~1 m/s holds 3-4 kgf/cm2 and burns 130 mL in about 20 min', { timeout: 60000 }, () => {
    const sim = newSim();
    sim.params.track.trainMass = 6;
    sim.resetHot();
    sim.controls.blower = 0;
    sim.controls.drains = true;
    const fuel0 = sim.fuel;
    let pMin = Infinity;
    for (let t = 0; t < 1800; t++) {
      if (t > 10) sim.controls.regulator = Math.min(1, Math.max(0.05, sim.controls.regulator + 0.01 * (1 - sim.v)));
      sim.controls.bypass = Math.min(1, Math.max(0, 0.5 + 2 * (sim.boiler.glass - 0.5)));
      if (t === 100) sim.controls.drains = false;
      sim.advance(0.1);
      if (t > 300) pMin = Math.min(pMin, kgf(sim));
    }
    expect(sim.v).toBeGreaterThan(0.9);
    expect(sim.v).toBeLessThan(1.1);
    expect(pMin).toBeGreaterThan(3);
    expect(kgf(sim)).toBeLessThan(4.2);
    expect(sim.boiler.glass).toBeGreaterThan(0.3);
    expect(sim.boiler.glass).toBeLessThan(0.8);
    const minutes = 130 / (((fuel0 - sim.fuel) * 1e6) / 3);
    expect(minutes).toBeGreaterThan(16);
    expect(minutes).toBeLessThan(25);
  });

  test('a wide-open regulator from rest slips the wheels', () => {
    const sim = newSim();
    sim.resetHot();
    sim.controls.regulator = 1;
    let slipped = false;
    for (let t = 0; t < 20; t++) {
      sim.advance(0.1);
      slipped ||= sim.warnings().includes('slip');
    }
    expect(slipped).toBe(true);
    expect(sim.v).toBeGreaterThan(0);
  });

  test('cold cylinders condense steam until warmed through', () => {
    const sim = newSim();
    sim.resetHot();
    sim.engine.reset(293.15, sim.phi);
    sim.mode = 'rollers';
    sim.controls.drains = true;
    sim.controls.regulator = 0.3;
    sim.advance(2);
    expect(sim.engine.liquidOut + sim.engine.liquid.reduce((a, b) => a + b)).toBeGreaterThan(0);
    const cold = sim.engine.wallT[0];
    sim.advance(20);
    expect(sim.engine.wallT[0]).toBeGreaterThan(cold + 30);
    sim.advance(40);
    expect(sim.engine.wallT[0]).toBeGreaterThan(373);
  });

  test('boiler runs low without feed water and the axle pump restores it', { timeout: 60000 }, () => {
    const sim = newSim();
    sim.resetHot();
    sim.mode = 'rollers';
    sim.controls.regulator = 0.3;
    sim.controls.bypass = 1;
    sim.advance(60);
    const low = sim.boiler.glass;
    expect(low).toBeLessThan(0.45);
    sim.controls.bypass = 0;
    sim.advance(30);
    expect(sim.boiler.glass).toBeGreaterThan(low);
  });
});
