import { afterEach, describe, expect, it, vi } from 'vitest';
import { TRANSLATIONS, setLocale, t } from '../i18n';
import { portOpenings } from '../sim/engine';
import { LocoSim } from '../sim/loco';
import { d51Params } from '../sim/params';
import { RUNNING_GEAR, pumpDisplacement, pumpPose, sidePhase } from '../sim/runningGear';
import { P_ATM, R_STEAM } from '../sim/steam';
import { phaseValues, portState, positionPaused, pumpState, pumpSvgGeometry } from './phaseBoard';
import source from './phaseBoard.ts?raw';

const makeSim = () => new LocoSim(structuredClone(d51Params));
const degrees = (angle: number) => angle * Math.PI / 180;
const { eccentricRadius: r, rodLength: l, axisY: h } = RUNNING_GEAR.pump;
const frontPhase = Math.asin(h / (l - r));
const rearPhase = Math.PI + Math.asin(h / (l + r));

afterEach(() => setLocale('zh-CN'));

describe('phase monitor values', () => {
  it('normalizes both cranks and preserves the 90° model convention through wraparound', () => {
    const sim = makeSim();
    for (const angle of [-1080, -90, -15, 0, 90, 180, 270, 359, 360, 1440]) {
      sim.phi = degrees(angle);
      const { sides, quartering, rodError } = phaseValues(sim, false);
      expect(quartering).toBeCloseTo(Math.PI / 2, 12);
      sides.forEach((side, i) => {
        expect(side.phase).toBeGreaterThanOrEqual(0);
        expect(side.phase).toBeLessThan(2 * Math.PI);
        expect(Math.cos(side.phase)).toBeCloseTo(Math.cos(sidePhase(sim.phi, i)), 12);
        expect(side.drivers).toHaveLength(4);
        expect(side.drivers.every(phase => phase === side.phase)).toBe(true);
        expect(side.sameSideError).toBe(0);
      });
      expect(rodError).toBeLessThan(1e-12);
    }
  });

  it('shows piston mid-stroke displacement and exact live valve geometry, including paused reverser edits', () => {
    const sim = makeSim();
    sim.phi = 0;
    expect(phaseValues(sim, true).sides[0].pose.piston).toBeCloseTo(sim.params.engine.stroke / 2, 12);
    sim.phi = Math.PI;
    expect(phaseValues(sim, true).sides[0].pose.piston).toBeCloseTo(-sim.params.engine.stroke / 2, 12);
    sim.phi = 0.8;
    sim.gear.setReverser(1); // Intentionally leave the interpolation table in forward gear.
    sim.controls.reverser = -1;
    const before = JSON.stringify(sim);
    const values = phaseValues(sim, true);
    values.sides.forEach(side => {
      const pose = sim.gear.solve(side.phase, -1);
      expect(side.pose.valve).toBe(pose.valve);
      const ports = portOpenings(sim.params.engine, pose.valve, { admFront: 0, admBack: 0, exhFront: 0, exhBack: 0 });
      expect(side.front).toBe(portState(ports.admFront, ports.exhFront));
      expect(side.back).toBe(portState(ports.admBack, ports.exhBack));
    });
    expect(JSON.stringify(sim)).toBe(before);
  });

  it('classifies admission, exhaust and closed ports at the lap boundaries', () => {
    const engine = { ...d51Params.engine, steamLap: 0.0012, exhaustLap: 0.0004 };
    const ports = (valve: number) => portOpenings(engine, valve, { admFront: 0, admBack: 0, exhFront: 0, exhBack: 0 });
    for (const valve of [-engine.exhaustLap, 0, engine.exhaustLap]) {
      const p = ports(valve);
      expect(portState(p.admFront, p.exhFront)).toBe('closed');
      expect(portState(p.admBack, p.exhBack)).toBe('closed');
    }
    const atLap = ports(engine.steamLap);
    expect(portState(atLap.admFront, atLap.exhFront)).toBe('closed');
    const positive = ports(engine.steamLap + 1e-6);
    expect(portState(positive.admFront, positive.exhFront)).toBe('admission');
    expect(portState(positive.admBack, positive.exhBack)).toBe('exhaust');
    const negative = ports(-engine.steamLap - 1e-6);
    expect(portState(negative.admBack, negative.exhBack)).toBe('admission');
    expect(portState(negative.admFront, negative.exhFront)).toBe('exhaust');
  });

  it('uses the third-driver pump pose and distinguishes signed motion, dead centres and stops', () => {
    const sim = makeSim();
    expect(RUNNING_GEAR.mainAxle).toBe(2);
    expect(RUNNING_GEAR.pumpAxle).toBe(2);
    for (const omega of [-4, -0.0001, 0.0001, 4]) {
      for (const phi of [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2, frontPhase, rearPhase]) {
        sim.phi = phi;
        sim.omega = omega;
        const values = phaseValues(sim, false);
        expect(values.pump).toEqual(pumpPose(phi, omega));
        expect(values.pumpState).toBe(phi === frontPhase || phi === rearPhase ? 'deadCentre'
          : values.pump.velocity < 0 ? 'delivery' : 'suction');
        expect(phaseValues(sim, true).pumpState).toBe('stopped');
        expect(phaseValues(sim, true).pump.velocity).toBe(0);
      }
    }
    expect(pumpState(pumpPose(1, 0), 0)).toBe('stopped');
    expect(pumpState(pumpPose(0, 0), 0)).toBe('stopped');
    expect(pumpPose(frontPhase, 1).strokeFraction).toBe(0);
    expect(pumpPose(rearPhase, 1).strokeFraction).toBe(1);
    expect(pumpState(pumpPose(0, 1), 1)).toBe('suction');
    expect(pumpState(pumpPose(Math.PI, 1), 1)).toBe('delivery');
  });

  it('uses radian offset dead centres through negative turns and does not mask nearby slow motion', () => {
    const sim = makeSim();
    for (const turns of [-7, -1, 0, 1, 7]) {
      for (const centre of [frontPhase, rearPhase]) {
        for (const omega of [-0.0001, 0.0001]) {
          sim.phi = centre + turns * 2 * Math.PI;
          sim.omega = omega;
          expect(phaseValues(sim, false).pumpState).toBe('deadCentre');
          for (const delta of [-1e-5, 1e-5]) {
            const pose = pumpPose(sim.phi + delta, omega);
            const compression = (centre === frontPhase ? delta : -delta) * omega > 0;
            expect(pumpState(pose, omega)).toBe(compression ? 'delivery' : 'suction');
          }
        }
      }
    }
  });

  it('has one delivery stroke and the estimated displacement per revolution in either rotation sense', () => {
    const volume = d51Params.feed.axlePumpPerRev;
    for (const sign of [-1, 1]) {
      let deliveryStarts = 0;
      let wasDelivering = false;
      for (let step = 0; step <= 360; step++) {
        const delivering = pumpState(pumpPose(frontPhase + sign * degrees(step), sign), sign) === 'delivery';
        if (delivering && !wasDelivering) deliveryStarts++;
        wasDelivering = delivering;
      }
      expect(deliveryStarts).toBe(1);
      expect(pumpDisplacement(0, sign * 2 * Math.PI, volume)).toBeCloseTo(volume, 15);
    }
  });
});

describe('offset pump SVG projection', () => {
  it('places the body on the ram axis above and behind the driving axle at a uniform scale', () => {
    const { bodyX, axisY } = RUNNING_GEAR.pump;
    const svg = pumpSvgGeometry(pumpPose(0, 1));
    const scale = svg.radius / r;
    const bodyCentre = { x: svg.body.x + svg.body.width / 2, y: svg.body.y + svg.body.height / 2 };
    expect(bodyCentre.x - svg.axle.x).toBeCloseTo((bodyX - RUNNING_GEAR.driverX[RUNNING_GEAR.pumpAxle]) * scale, 12);
    expect(bodyCentre.y - svg.axle.y).toBeCloseTo(-axisY * scale, 12);
    expect(bodyCentre.y).toBeCloseTo(svg.ram.y, 12);
    expect(svg.ramStart.y).toBe(svg.ram.y);
    expect(svg.ramStart.x - bodyCentre.x).toBeCloseTo(-0.004 * scale, 12);
    expect(svg.body.width).toBeCloseTo(0.023 * scale, 12);
    expect(svg.body.height).toBeCloseTo(0.009 * scale, 12);
    expect(bodyCentre.y).toBeLessThan(svg.axle.y);
  });

  it('fits the complete sweep, body, orbit, stroke widths and labels without viewBox jitter', () => {
    const initial = pumpSvgGeometry(pumpPose(0, 1));
    const phases = [frontPhase, rearPhase, ...Array.from({ length: 721 }, (_, i) => degrees(i - 360))];
    for (const phase of phases) {
      const svg = pumpSvgGeometry(pumpPose(phase, 1));
      const inside = (x: number, y: number, margin: number) => {
        expect(x - margin).toBeGreaterThanOrEqual(0);
        expect(x + margin).toBeLessThanOrEqual(svg.width);
        expect(y - margin).toBeGreaterThanOrEqual(0);
        expect(y + margin).toBeLessThan(svg.labelY - 10);
      };
      expect(svg.width).toBe(initial.width);
      expect(svg.height).toBe(initial.height);
      expect(svg.body).toEqual(initial.body);
      inside(svg.body.x, svg.body.y, 1);
      inside(svg.body.x + svg.body.width, svg.body.y + svg.body.height, 1);
      inside(svg.axle.x, svg.axle.y, svg.radius + 1);
      for (const point of [svg.eccentric, svg.ram, svg.ramStart]) inside(point.x, point.y, 3);
      expect(svg.labelY + 4).toBeLessThan(svg.height);
      expect(svg.left).toBeGreaterThan(0);
      expect(svg.right).toBeLessThan(svg.width);
      const scale = svg.radius / r;
      expect(Math.hypot(svg.eccentric.x - svg.ram.x, svg.eccentric.y - svg.ram.y) / scale).toBeCloseTo(l, 12);
    }
  });
});

describe('paused positioning', () => {
  it('ignores live events and non-finite angles without touching any simulation state', () => {
    const sim = makeSim();
    sim.resetHot();
    sim.omega = 3;
    sim.v = 0.2;
    const before = JSON.stringify(sim);
    expect(positionPaused(sim, false, 90)).toBe(false);
    for (const invalid of [NaN, Infinity, -Infinity]) expect(positionPaused(sim, true, invalid)).toBe(false);
    expect(JSON.stringify(sim)).toBe(before);
  });

  it('zeros speeds and reconciles every chamber at average wall temperature without resetting boiler or resources', () => {
    const sim = makeSim();
    sim.resetHot();
    sim.time = 123;
    sim.distance = 6;
    sim.fuel *= 0.8;
    sim.engine.wallT[0] = 360;
    sim.engine.wallT[1] = 400;
    sim.engine.P.fill(3 * P_ATM);
    sim.engine.liquid.fill(0.001);
    sim.omega = 4;
    sim.v = 0.1;
    const preserved = () => JSON.stringify({
      boiler: sim.boiler, time: sim.time, distance: sim.distance, fuel: sim.fuel, oil: sim.oil,
      tender: sim.tenderWater, lit: sim.lit, controls: sim.controls,
      fuelBurned: sim.fuelBurned, steamUsed: sim.steamUsed, waterFed: sim.waterFed,
    });
    const before = preserved();
    const reset = vi.spyOn(sim.engine, 'reset');
    expect(positionPaused(sim, true, -90)).toBe(true);
    expect(sim.phi).toBeCloseTo(3 * Math.PI / 2, 12);
    expect(sim.omega).toBe(0);
    expect(sim.v).toBe(0);
    expect(reset).toHaveBeenCalledExactlyOnceWith(380, sim.phi);
    expect([...sim.engine.wallT]).toEqual([380, 380]);
    for (let side = 0; side < 2; side++) {
      for (let end = 0; end < 2; end++) {
        const i = side * 2 + end;
        const expectedVolume = sim.engine.volume(end, sim.gear.piston(sidePhase(sim.phi, side)));
        expect(sim.engine.m[i] * R_STEAM * sim.engine.T[i] / sim.engine.P[i]).toBeCloseTo(expectedVolume, 14);
        expect(sim.engine.P[i]).toBe(P_ATM);
        expect(sim.engine.liquid[i]).toBe(0);
      }
    }
    expect(preserved()).toBe(before);
    // Both step-button wraparounds and the slider's 360° endpoint are valid positions.
    expect(positionPaused(sim, true, 375)).toBe(true);
    expect(sim.phi).toBeCloseTo(degrees(15), 12);
    expect(positionPaused(sim, true, 360)).toBe(true);
    expect(sim.phi).toBe(0);
  });
});

describe('phase monitor translation registry', () => {
  it('registers Chinese source literals, inserted static nodes and accessible names in both locales', () => {
    const keys = [
      ...[...source.matchAll(/'([^'\n]*)'/g)].map(match => match[1]),
      ...[...source.matchAll(/>([^<>\n]+)</g)].map(match => match[1].trim()),
      ...[...source.matchAll(/aria-label="([^"]+)"/g)].map(match => match[1]),
    ].filter(key => /[\u3400-\u9fff]/.test(key));
    expect(keys.length).toBeGreaterThan(25);
    for (const key of keys) {
      expect(Object.hasOwn(TRANSLATIONS, key), key).toBe(true);
      for (const locale of ['en', 'ja'] as const) {
        setLocale(locale);
        expect(t(key), key).toBe(TRANSLATIONS[key][locale === 'en' ? 0 : 1]);
      }
    }
  });
});