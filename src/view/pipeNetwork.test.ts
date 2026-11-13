import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { TRANSLATIONS, setLocale, t } from '../i18n';
import { LocoSim } from '../sim/loco';
import { d51Params } from '../sim/params';
import { FLOW_COLORS, FLOW_LEGEND, FlowOverlay, type FlowKind } from './flow';
import flowSource from './flow.ts?raw';
import { LAYOUT, type LocoModel } from './locoModel';
import { pipeCurve, pumpPorts, steamNetwork, type PipePoint, type PipeRun } from './pipeNetwork';

const cylinderX = d51Params.gear.conRod + d51Params.gear.pistonRod;
const network = () => steamNetwork(LAYOUT, cylinderX, d51Params.gear.valveSpindleY);
const key = (point: PipePoint) => JSON.stringify(point);
const end = (run: PipeRun) => run.points[run.points.length - 1];

/** Directed paths through run endpoints; equal coordinates, not object identity, define a joint. */
function pathsBetween(runs: PipeRun[], from: PipePoint, to: PipePoint, seen = new Set<string>()): string[][] {
  if (key(from) === key(to)) return [[]];
  if (seen.has(key(from))) return [];
  const visited = new Set(seen).add(key(from));
  return runs.filter(run => key(run.points[0]) === key(from)).flatMap(run =>
    pathsBetween(runs, end(run), to, visited).map(path => [run.id, ...path]));
}

function expectPoint(actual: THREE.Vector3, expected: PipePoint): void {
  expect(actual.distanceTo(new THREE.Vector3(...expected))).toBeLessThan(1e-10);
}

afterEach(() => setLocale('zh-CN'));

describe('steam network topology (estimated centrelines)', () => {
  it('routes regulator steam through either of two U-tubes to each chest without a shortcut', () => {
    const { nodes, runs } = network();
    const supply = runs.filter(run => run.circuit === 'admission');
    expect(pathsBetween(supply, nodes.steamSpace, nodes.regulator)).toEqual([['regulator-inlet']]);
    for (const [side, chest] of [['left', nodes.leftChest], ['right', nodes.rightChest]] as const) {
      const paths = pathsBetween(supply, nodes.regulator, chest);
      expect(paths).toHaveLength(2);
      expect(paths).toEqual(expect.arrayContaining([
        ['dry-pipe', 'superheater-left', 'superheater-outlet', `admission-${side}`],
        ['dry-pipe', 'superheater-right', 'superheater-outlet', `admission-${side}`],
      ]));
      expect(chest).toEqual([cylinderX, d51Params.gear.valveSpindleY + 0.00475, (side === 'left' ? -1 : 1) * LAYOUT.cylZ]);
    }
    for (const [side, sign] of [['left', -1], ['right', 1]] as const) {
      const hairpin = runs.find(run => run.id === `superheater-${side}`)!;
      expect(hairpin.points).toEqual([
        nodes.inletHeader,
        [LAYOUT.shHeaderX, LAYOUT.flueY + LAYOUT.shPitch, sign * LAYOUT.flueZ],
        [LAYOUT.innerX1 - LAYOUT.shLen - LAYOUT.shPitch, LAYOUT.flueY + LAYOUT.shPitch, sign * LAYOUT.flueZ],
        [LAYOUT.innerX1 - LAYOUT.shLen - LAYOUT.shPitch, LAYOUT.flueY - LAYOUT.shPitch, sign * LAYOUT.flueZ],
        [LAYOUT.shHeaderX, LAYOUT.flueY - LAYOUT.shPitch, sign * LAYOUT.flueZ],
        nodes.outletHeader,
      ]);
    }
  });

  it('merges both cylinder exhausts at one tee and terminates at the blast nozzle', () => {
    const { nodes, runs } = network();
    const exhaust = runs.filter(run => run.circuit === 'exhaust');
    expect(exhaust).toHaveLength(3);
    expect(exhaust.every(run => run.kind === 'exhaust')).toBe(true);
    for (const [side, outlet] of [['left', nodes.leftExhaust], ['right', nodes.rightExhaust]] as const) {
      expect(pathsBetween(exhaust, outlet, nodes.exhaustTee)).toEqual([[`exhaust-${side}`]]);
      expect(pathsBetween(exhaust, outlet, nodes.blastNozzle)).toEqual([[`exhaust-${side}`, 'blast-pipe']]);
    }
  });

  it('keeps the blower circuit independent from exhaust and admission joints', () => {
    const { nodes, runs } = network();
    const blower = runs.filter(run => run.circuit === 'blower');
    expect(blower).toHaveLength(2);
    expect(blower.every(run => run.kind === 'steam')).toBe(true);
    expect(pathsBetween(blower, nodes.blowerSpace, nodes.blowerNozzle)).toEqual([['blower-inlet', 'blower-pipe']]);
    const otherPoints = runs.filter(run => run.circuit !== 'blower').flatMap(run => run.points);
    for (const point of blower.flatMap(run => run.points)) {
      for (const other of otherPoints) {
        expect(new THREE.Vector3(...point).distanceTo(new THREE.Vector3(...other))).toBeGreaterThan(1e-6);
      }
    }
    expect(pathsBetween(runs, nodes.blowerSpace, nodes.blastNozzle)).toEqual([]);
    expect(pathsBetween(runs, nodes.leftExhaust, nodes.blowerNozzle)).toEqual([]);
    expect(pathsBetween(runs, nodes.regulator, nodes.blowerNozzle)).toEqual([]);
  });

  it('has unique runs and only the intended source, junction and terminal degrees', () => {
    const { nodes, runs } = network();
    expect(new Set(runs.map(run => run.id)).size).toBe(runs.length);
    // Treat reversed copies as duplicate geometry too; parallel U-tubes remain distinct.
    const geometries = runs.map(run => [JSON.stringify(run.points), JSON.stringify([...run.points].reverse())].sort()[0]);
    expect(new Set(geometries).size).toBe(runs.length);
    const nodeKeys = new Set(Object.values(nodes).map(key));
    expect(nodeKeys.size).toBe(Object.keys(nodes).length);
    for (const run of runs) {
      expect(nodeKeys.has(key(run.points[0])), `${run.id} inlet`).toBe(true);
      expect(nodeKeys.has(key(end(run))), `${run.id} outlet`).toBe(true);
    }
    const degrees: Record<keyof typeof nodes, [number, number]> = {
      steamSpace: [0, 1], regulator: [1, 1], inletHeader: [1, 2], outletHeader: [2, 1],
      admissionTee: [1, 2], leftChest: [1, 0], rightChest: [1, 0],
      leftExhaust: [0, 1], rightExhaust: [0, 1], exhaustTee: [2, 1], blastNozzle: [1, 0],
      blowerSpace: [0, 1], blowerValve: [1, 1], blowerNozzle: [1, 0],
    };
    for (const name of Object.keys(degrees) as (keyof typeof nodes)[]) {
      const incoming = runs.filter(run => key(end(run)) === key(nodes[name])).length;
      const outgoing = runs.filter(run => key(run.points[0]) === key(nodes[name])).length;
      expect([incoming, outgoing], name).toEqual(degrees[name]);
    }
  });
});

describe('shared pipe curves', () => {
  it('preserves every endpoint and has finite positions and unit tangents through all elbows', () => {
    // Also exercise a changed layout/cylinder position so the helper cannot rely on defaults.
    const networks = [network(), steamNetwork({ ...LAYOUT, shHeaderX: 0.162, flueZ: 0.009, chimneyX: 0.19 }, 0.158, 0.014)];
    for (const { runs } of networks) {
      const before = JSON.stringify(runs);
      for (const run of runs) {
        expect(run.radius).toBeGreaterThan(0);
        expect(Number.isFinite(run.radius)).toBe(true);
        const curve = pipeCurve(run.points);
        expect(curve.getLength()).toBeGreaterThan(0);
        expect(Number.isFinite(curve.getLength())).toBe(true);
        expectPoint(curve.getPoint(0), run.points[0]);
        expectPoint(curve.getPoint(1), end(run));
        expectPoint(curve.getPointAt(0), run.points[0]);
        expectPoint(curve.getPointAt(1), end(run));
        for (let i = 0; i <= 100; i++) {
          const point = curve.getPointAt(i / 100);
          const tangent = curve.getTangentAt(i / 100);
          expect([...point.toArray(), ...tangent.toArray()].every(Number.isFinite), run.id).toBe(true);
          expect(tangent.length(), run.id).toBeCloseTo(1, 10);
        }
      }
      expect(JSON.stringify(runs)).toBe(before);
    }
  });
});

/** Only the overlay's model inputs are needed; no renderer or full locomotive construction. */
function makeOverlay() {
  const sim = new LocoSim(structuredClone(d51Params));
  const pipework = steamNetwork({ ...LAYOUT, shHeaderX: 0.161, chimneyX: 0.19 }, cylinderX + 0.002, 0.014);
  const tenderToLoco = (x: number, y: number, z: number) => new THREE.Vector3(x - LAYOUT.tenderDist, y, z);
  const model = { pipework, tenderToLoco, cylX0: cylinderX + 0.002 } as unknown as LocoModel;
  const overlay = new FlowOverlay(sim, model);
  const tubes = overlay.group.children.filter((child): child is THREE.Mesh<THREE.TubeGeometry, THREE.MeshBasicMaterial> =>
    child instanceof THREE.Mesh && child.geometry instanceof THREE.TubeGeometry);
  const ofKind = (kind: FlowKind) => tubes.filter(tube => tube.material.color.getHex() === FLOW_COLORS[kind]);
  return { sim, pipework, overlay, tubes, ofKind, tenderToLoco };
}

describe('flow overlay network integration', () => {
  it('draws exactly one shared centreline per run plus two nozzle-to-chimney free jets', () => {
    const { pipework, tubes, ofKind } = makeOverlay();
    const steamColors = new Set<number>([FLOW_COLORS.steam, FLOW_COLORS.superheated, FLOW_COLORS.exhaust]);
    const steamTubes = tubes.filter(tube => steamColors.has(tube.material.color.getHex()));
    expect(steamTubes).toHaveLength(pipework.runs.length + 2);
    pipework.runs.forEach((run, i) => {
      const actual = steamTubes[i].geometry.parameters.path;
      const expected = pipeCurve(run.points);
      expect(steamTubes[i].material.color.getHex()).toBe(FLOW_COLORS[run.kind]);
      for (let sample = 0; sample <= 50; sample++) {
        expect(actual.getPointAt(sample / 50).distanceTo(expected.getPointAt(sample / 50))).toBeLessThan(1e-12);
      }
    });
    for (const [i, node] of [pipework.nodes.blastNozzle, pipework.nodes.blowerNozzle].entries()) {
      const jet = steamTubes[pipework.runs.length + i].geometry.parameters.path;
      expectPoint(jet.getPointAt(0), node);
      expectPoint(jet.getPointAt(1), [node[0], LAYOUT.chimneyTop + 0.008, node[2]]);
    }
    expect(ofKind('fuel')).toHaveLength(1);
    expect(ofKind('gas')).toHaveLength(2);
    expect(ofKind('heat')).toHaveLength(12);
  });

  it('connects suction and delivery to the pump ports while preserving the boiler/bypass tee', () => {
    const { ofKind, tenderToLoco } = makeOverlay();
    const water = ofKind('water').map(tube => tube.geometry.parameters.path);
    const bypass = ofKind('bypass').map(tube => tube.geometry.parameters.path);
    const ports = pumpPorts();
    expect(water).toHaveLength(3);
    expect(bypass).toHaveLength(1);
    expectPoint(water[0].getPointAt(0), tenderToLoco(0.08, 0.026, -0.02).toArray());
    expectPoint(water[0].getPointAt(1), ports.inlet);
    expectPoint(water[1].getPointAt(0), ports.outlet);
    const tee: PipePoint = [-0.03, 0.024, -0.018];
    expectPoint(water[1].getPointAt(1), tee);
    expectPoint(water[2].getPointAt(0), tee);
    expectPoint(water[2].getPointAt(1), [-0.03, 0.05, -0.018]);
    const expectedBypass = pipeCurve([
      tee, [-0.03, 0.024, -0.03], [-0.19, 0.024, -0.03],
      tenderToLoco(0.1, 0.066, -0.03).toArray(), tenderToLoco(0.06, 0.066, -0.03).toArray(), tenderToLoco(0.06, 0.05, -0.03).toArray(),
    ]);
    for (let i = 0; i <= 20; i++) {
      expect(bypass[0].getPointAt(i / 20).distanceTo(expectedBypass.getPointAt(i / 20))).toBeLessThan(1e-12);
    }
  });

  it('drives each circuit independently and keeps arrow transforms finite', () => {
    const { sim, pipework, overlay } = makeOverlay();
    const arrows = overlay.group.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh);
    // The four water/bypass paths precede the network runs.
    const networkArrows = arrows.slice(4, 4 + pipework.runs.length);
    for (const active of ['admission', 'exhaust', 'blower'] as const) {
      sim.steamFlow = active === 'admission' ? 3e-4 : 0;
      sim.exhaustFlow = active === 'exhaust' ? 3e-4 : 0;
      sim.blowerFlow = active === 'blower' ? 5e-5 : 0;
      overlay.update(0.016);
      networkArrows.forEach((arrow, i) => {
        expect(arrow.visible, pipework.runs[i].id).toBe(pipework.runs[i].circuit === active);
        expect([...arrow.instanceMatrix.array].every(Number.isFinite)).toBe(true);
      });
      expect(arrows[4 + pipework.runs.length].visible).toBe(active === 'exhaust');
      expect(arrows[5 + pipework.runs.length].visible).toBe(active === 'blower');
    }
  });

  it('translates live labels on locale changes and renders units exactly once', () => {
    const keys = [...FLOW_LEGEND.map(([, label]) => label), ...[...flowSource.matchAll(/\bt\('([^']+)'/g)].map(match => match[1])];
    for (const source of keys) expect(Object.hasOwn(TRANSLATIONS, source), source).toBe(true);
    const { sim, overlay } = makeOverlay();
    sim.feedFlow = 1e-4;
    sim.pumpFlow = 3e-4;
    sim.steamFlow = 2.5e-4;
    sim.blowerFlow = 5e-5;
    sim.exhaustFlow = 2e-4;
    sim.superheat = 32;
    sim.heatToWater = 400;
    sim.firePower = 0;
    const expected = [
      ['给水 {flow} g/s', { flow: '0.10' }],
      ['旁通回水 {flow} g/s', { flow: '0.20' }],
      ['饱和蒸汽 {flow} g/s', { flow: '0.25' }],
      ['通风 {flow} g/s', { flow: '0.05' }],
      ['过热器 +{temperature} K', { temperature: '32' }],
      ['排汽 {flow} g/s', { flow: '0.20' }],
      ['烟气（烟管 ×2）', {}],
      ['酒精 {flow} mL/min', { flow: '0.0' }],
      ['传给水 {power} W', { power: '400' }],
    ] as const;
    for (const locale of ['zh-CN', 'en', 'ja'] as const) {
      setLocale(locale);
      expect(overlay.labels.map(label => label.text())).toEqual(expected.map(([source, values]) => t(source, values)));
      for (const label of overlay.labels) {
        expect(label.text()).not.toMatch(/\{\w+\}|g\/s\s+g\/s|mL\/min\s+mL\/min/);
      }
    }
    sim.feedFlow = 2e-4;
    expect(overlay.labels[0].text()).toBe(t('给水 {flow} g/s', { flow: '0.20' }));
  });
});