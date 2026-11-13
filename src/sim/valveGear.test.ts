import { describe, expect, test } from 'vitest';
import { portOpenings } from './engine';
import { d51Params } from './params';
import { ValveGear, type Vec2 } from './valveGear';

const distance = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);

describe('Aster drawing 9 valve-gear topology', () => {
  const params = structuredClone(d51Params);
  const gear = new ValveGear(params);

  test('return-crank pin is above the axle at front dead centre, below at rear', () => {
    expect(gear.solve(0, 1).eccPin.y).toBeGreaterThan(0);
    expect(gear.solve(Math.PI, 1).eccPin.y).toBeLessThan(0);
    expect(gear.solve(Math.PI / 2, 1).eccPin.x).toBeGreaterThan(0);
    expect(gear.solve(3 * Math.PI / 2, 1).eccPin.x).toBeLessThan(0);
  });

  test('radius rod attaches above the valve spindle; all rods close in both gears', () => {
    const g = params.gear;
    for (const reverser of [-1, -0.5, 0, 0.5, 1]) {
      for (let degree = 0; degree < 360; degree++) {
        const pose = gear.solve(degree * Math.PI / 180, reverser);
        expect(pose.leverTop.y).toBeGreaterThan(pose.leverMid.y);
        expect(pose.leverMid.y).toBe(g.valveSpindleY);
        expect(pose.leverBottom.y).toBeLessThan(pose.leverMid.y);
        expect(distance(pose.leverTop, pose.dieBlock)).toBeCloseTo(g.radiusRod, 10);
        expect(distance(pose.leverTop, pose.leverMid)).toBeCloseTo(g.leverUpper, 10);
        expect(distance(pose.leverBottom, pose.leverMid)).toBeCloseTo(g.leverLower, 10);
        expect(distance(pose.leverBottom, pose.dropPin)).toBeCloseTo(g.unionLink, 10);
        expect(distance(pose.linkTail, pose.eccPin)).toBeCloseTo(gear.eccRod, 10);
      }
    }
  });

  test('crossed passages feed the front cylinder end when the valve moves forward', () => {
    const e = params.engine;
    const open = { admFront: 0, admBack: 0, exhFront: 0, exhBack: 0 };
    portOpenings(e, e.steamLap + e.portWidth, open);
    expect(open).toEqual({ admFront: e.portWidth, admBack: 0, exhFront: 0, exhBack: e.portWidth });
    portOpenings(e, -e.steamLap - e.portWidth, open);
    expect(open).toEqual({ admFront: 0, admBack: e.portWidth, exhFront: e.portWidth, exhBack: 0 });
  });

  test.each([1, -1])('dead-centre lead and first-quarter admission drive direction %s', direction => {
    const open = { admFront: 0, admBack: 0, exhFront: 0, exhBack: 0 };
    const front = gear.solve(0, direction);
    const rear = gear.solve(Math.PI, direction);
    expect(front.valve).toBeGreaterThan(params.engine.steamLap);
    expect(rear.valve).toBeLessThan(-params.engine.steamLap);
    for (const [angle, end] of [[direction * Math.PI / 2, 'front'], [direction * Math.PI * 1.5, 'rear']] as const) {
      portOpenings(params.engine, gear.solve(angle, direction).valve, open);
      expect(end === 'front' ? open.admFront : open.admBack).toBeGreaterThan(0);
      expect(end === 'front' ? open.exhBack : open.exhFront).toBeGreaterThan(0);
      const forceSign = end === 'front' ? -1 : 1;
      expect(forceSign * gear.dPiston(angle) * direction).toBeGreaterThan(0);
    }
  });
});