import * as THREE from 'three';
import type { LocoSim } from '../sim/loco';
import type { Vec2 } from '../sim/valveGear';
import { PART_COLORS, PART_LABELS, type PartName, pressureHue, pressureLevel } from './colors';

export type ViewMode = 'normal' | 'xray' | 'mech';

/**
 * Body layout at 1:30, relative to the main (3rd) driving axle; x forward, y up, z to the right.
 * Outline follows the JNR D51 standard type (wheelbase, boiler height, overall length). The internal
 * arrangement follows the Aster manual: the schematic on p.10 (side section: firebox, flue, hairpin
 * superheater, three wicks), assembly drawing 17 (front tube plate with two flue openings and two unions;
 * the superheater is one part, no. 17-5, made of two hairpin elements joined by headers) and drawing 23
 * (three wick tubes). So: a single boiler drum inside the outer case, cut away at the rear above the
 * burner, two flue tubes through the water space, one superheater whose two hairpins go into the flues
 * from the smokebox, regulator and blower steam led forward through the boiler. The counts are from
 * those drawings and the parts list; all dimensions, and whether the hairpin legs lie side by side or
 * one above the other, are estimates. Visual only: the simulation does not read these numbers.
 */
export const LAYOUT = {
  driverX: [0.1034, 0.0517, 0, -0.0517],
  smallR: 0.0143,
  leadX: 0.185,
  trailX: -0.128,
  boilerY: 0.06,
  caseR: 0.03,
  fireboxX0: -0.112,
  barrelX0: -0.045,
  smokeboxX0: 0.15,
  smokeboxX1: 0.212,
  innerR: 0.0235,
  innerY: 0.06,
  /** backhead and front tube plate */
  innerX0: -0.104,
  innerX1: 0.146,
  /** front wall of the firebox; behind it only the part of the drum above crownY exists */
  throatX: -0.04,
  crownY: 0.055,
  flueR: 0.0062,
  flueY: 0.0475,
  flueZ: 0.0082,
  /** superheater: hairpin length inside the flue, half the leg spacing, header position in the smokebox */
  shLen: 0.13,
  shPitch: 0.0024,
  shHeaderX: 0.155,
  /** pipes running through the boiler from the backhead valves to the front tube plate */
  steamPipeY: 0.068,
  blowerPipeY: 0.057,
  blowerPipeZ: -0.004,
  cabX0: -0.188,
  chimneyX: 0.186,
  chimneyTop: 0.108,
  blastY: 0.05,
  boardY: 0.034,
  wheelZ: 0.0235,
  cylZ: 0.035,
  tenderDist: 0.315,
  burnerX: -0.082,
  pumpX: 0.03,
} as const;

const PISTON_T = 0.005;
const CLEAR_LEN = 0.002;
const UP = new THREE.Vector3(0, 1, 0);
const BLACK = 0x17191c;
const GRAPHITE = 0x25282c;
/** colour of the whole engine while it is drawn as a glass model behind the flow overlay */
const GHOST = 0x9db2c9;

function box(lx: number, ly: number, lz: number, m: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(lx, ly, lz), m);
}

function cylX(r: number, len: number, m: THREE.Material, seg = 32): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateZ(Math.PI / 2);
  return new THREE.Mesh(g, m);
}

function cylY(r: number, len: number, m: THREE.Material, seg = 20): THREE.Mesh {
  return new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), m);
}

function cylZ(r: number, len: number, m: THREE.Material, seg = 32): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateX(Math.PI / 2);
  return new THREE.Mesh(g, m);
}

/** Upper half of a cylinder lying along x. */
function halfCylX(r: number, len: number, m: THREE.Material): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r, r, len, 24, 1, false, 0, Math.PI);
  g.rotateZ(Math.PI / 2);
  return new THREE.Mesh(g, m);
}

/** The part of a cylinder lying along x that is above the chord y = cut; runs from x = 0 to x = len. */
function segX(r: number, cut: number, len: number, m: THREE.Material): THREE.Mesh {
  const a = Math.asin(cut / r);
  const shape = new THREE.Shape();
  shape.absarc(0, 0, r, a, Math.PI - a, false);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments: 24 });
  g.rotateY(Math.PI / 2);
  return new THREE.Mesh(g, m);
}

/** Area of a circle of radius r lying below a line at height h above its lowest point. */
function capArea(r: number, h: number): number {
  const c = Math.min(2 * r, Math.max(0, h));
  return r * r * Math.acos(1 - c / r) - (r - c) * Math.sqrt(Math.max(0, 2 * r * c - c * c));
}

function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number, parent: THREE.Object3D): T {
  o.position.set(x, y, z);
  parent.add(o);
  return o;
}

function solid(color: number, metalness = 0.4, roughness = 0.55): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color, metalness, roughness });
  m.userData = { color, metalness };
  return m;
}

/** Material for parts inside the boiler: drawn over the water, never hiding what is behind. */
function inside(color: number, opacity: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.5, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
}

function paint(m: THREE.MeshStandardMaterial, color: number, opacity: number, metalness: number): void {
  m.color.setHex(color);
  m.metalness = metalness;
  m.opacity = opacity;
  m.transparent = opacity < 1;
  m.depthWrite = opacity >= 1;
  m.needsUpdate = true;
}

/** A bar drawn between two points of the side-view plane. */
class Link {
  readonly mesh: THREE.Mesh;
  constructor(parent: THREE.Object3D, z: number, height: number, width: number, m: THREE.Material) {
    this.mesh = box(1, height, width, m);
    this.mesh.position.z = z;
    parent.add(this.mesh);
  }
  set(a: Vec2, b: Vec2): void {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    this.mesh.position.x = (a.x + b.x) / 2;
    this.mesh.position.y = (a.y + b.y) / 2;
    this.mesh.rotation.z = Math.atan2(dy, dx);
    this.mesh.scale.x = Math.max(1e-4, Math.hypot(dx, dy));
  }
}

type LinkName = 'coupling' | 'mainRod' | 'pistonRod' | 'dropArm' | 'returnCrank' | 'eccRod' | 'link' | 'radiusRod' | 'lever' | 'union' | 'spindle';

interface Side {
  index: number;
  sign: number;
  wheels: THREE.Object3D[];
  links: Record<LinkName, Link>;
  crosshead: THREE.Mesh;
  piston: THREE.Mesh;
  valve: THREE.Mesh;
  dieBlock: THREE.Mesh;
  steam: THREE.Mesh[];
  chestSteam: THREE.Mesh;
}

export interface Label {
  text: string;
  anchor: THREE.Object3D;
  kind: 'struct' | 'mech';
  /** -1 left, +1 right, 0 = always shown */
  side: number;
  color?: number;
  /** part inside the boiler or smokebox: only labelled while the shells are see-through */
  inner?: boolean;
}

interface ExplodePart {
  group: THREE.Group;
  base: THREE.Vector3;
  offset: THREE.Vector3;
}

const BUBBLES = 40;
const LEVELS = 48;

export class LocoModel {
  readonly root = new THREE.Group();
  readonly labels: Label[] = [];
  readonly chimney = new THREE.Object3D();
  readonly safety: THREE.Object3D[] = [];
  readonly whistle = new THREE.Object3D();
  readonly drains: THREE.Object3D[] = [];
  readonly cylX0: number;
  explode = 0;

  private readonly rw: number;
  private readonly tenderBase: THREE.Vector3;
  private readonly tenderYaw: number;
  private readonly parts: ExplodePart[] = [];
  private readonly shellMats: THREE.MeshStandardMaterial[] = [];
  private readonly casingMats: THREE.MeshStandardMaterial[] = [];
  private readonly solidMats: THREE.MeshStandardMaterial[] = [];
  private readonly partMats = {} as Record<PartName, THREE.MeshStandardMaterial>;
  private readonly sides: Side[] = [];
  private readonly smallWheels: THREE.Object3D[] = [];
  private readonly flames: THREE.Mesh[] = [];
  private readonly waterPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  private readonly internals = new THREE.Group();
  private inner!: THREE.Group;
  private waterMat!: THREE.MeshStandardMaterial;
  private steamMat!: THREE.MeshBasicMaterial;
  private flueGasMat!: THREE.MeshBasicMaterial;
  private readonly flueGas: THREE.Mesh[] = [];
  private bubbles!: THREE.Points;
  private readonly bubbleSeed = new Float32Array(BUBBLES);
  private readonly bubbleBase = new Float32Array(BUBBLES);
  /** liquid volume fraction below LEVELS + 1 equally spaced heights across the drum */
  private readonly levelTable = new Float32Array(LEVELS + 1);
  private tenderWater!: THREE.Mesh;
  private tenderFuel!: THREE.Mesh;

  private readonly steel = solid(0xb9bec4, 0.9, 0.3);
  private readonly brass = solid(0xc9a646, 0.9, 0.3);
  private readonly dark = solid(0x2a2d31);
  private readonly wheelMat = solid(0x1d1f22, 0.5, 0.5);
  private readonly holeMat = solid(0x08090a, 0.2, 0.9);

  constructor(
    private readonly sim: LocoSim,
    trackRadius: number,
  ) {
    this.rw = sim.params.chassis.wheelDia / 2;
    this.cylX0 = sim.params.gear.conRod + sim.params.gear.pistonRod;
    // on a circular track the tender sits at a fixed pose relative to the engine
    const a = LAYOUT.tenderDist / trackRadius;
    this.tenderBase = new THREE.Vector3(-trackRadius * Math.sin(a), 0, -trackRadius * (1 - Math.cos(a)));
    this.tenderYaw = -a;

    for (const name of Object.keys(PART_COLORS) as PartName[]) this.partMats[name] = solid(name === 'link' ? 0xc9a646 : 0xb9bec4, 0.9, 0.3);
    this.solidMats.push(this.steel, this.brass, this.dark, this.wheelMat, this.holeMat);

    this.buildFrame();
    this.buildCase();
    this.buildInner();
    this.buildCab();
    this.buildMotion();
    this.buildTender();
    this.setMode('normal', false);
  }

  /** Convert a point given in tender coordinates to engine coordinates. */
  tenderToLoco(x: number, y: number, z: number): THREE.Vector3 {
    return new THREE.Vector3(x, y, z).applyAxisAngle(UP, this.tenderYaw).add(this.tenderBase);
  }

  private shell(color = BLACK, metalness = 0.5, roughness = 0.45): THREE.MeshStandardMaterial {
    const m = solid(color, metalness, roughness);
    this.shellMats.push(m);
    return m;
  }

  private casing(color = BLACK, metalness = 0.5, roughness = 0.45): THREE.MeshStandardMaterial {
    const m = solid(color, metalness, roughness);
    this.casingMats.push(m);
    return m;
  }

  private group(offset: [number, number, number], base = new THREE.Vector3()): THREE.Group {
    const group = new THREE.Group();
    group.position.copy(base);
    this.root.add(group);
    this.parts.push({ group, base, offset: new THREE.Vector3(...offset) });
    return group;
  }

  private label(text: string, parent: THREE.Object3D, x: number, y: number, z: number, inner = false): void {
    this.labels.push({ text, anchor: at(new THREE.Object3D(), x, y, z, parent), kind: 'struct', side: 0, inner });
  }

  /** True while the boiler internals are drawn. */
  get internalsVisible(): boolean {
    return this.internals.visible;
  }

  private driver(parent: THREE.Object3D, x: number, z: number, crank: number): THREE.Object3D {
    const g = new THREE.Group();
    const side = Math.sign(z);
    const r = this.rw;
    g.add(cylZ(r, 0.005, this.steel));
    at(cylZ(r + 0.0016, 0.0012, this.steel), 0, 0, -side * 0.0031, g);
    g.add(cylZ(r * 0.9, 0.0056, this.wheelMat));
    // boxpok centre: pockets instead of spokes
    for (const deg of [50, 90, 130, 230, 270, 310]) {
      const t = (deg * Math.PI) / 180;
      at(cylZ(r * 0.12, 0.0058, this.holeMat, 12), r * 0.58 * Math.cos(t), r * 0.58 * Math.sin(t), 0, g);
    }
    at(box(r * 0.36, r * 1.05, 0.0062, this.wheelMat), -r * 0.6, 0, 0, g);
    g.add(cylZ(r * 0.2, 0.0066, this.wheelMat));
    at(cylZ(0.0036, 0.0066, this.wheelMat, 12), crank, 0, 0, g);
    at(cylZ(0.002, 0.016, this.steel, 12), crank, 0, side * 0.008, g);
    return at(g, x, 0, z, parent);
  }

  private smallWheel(parent: THREE.Object3D, x: number, z: number, spoked: boolean): void {
    const g = new THREE.Group();
    const side = Math.sign(z);
    const r = LAYOUT.smallR;
    g.add(cylZ(r, 0.0045, this.steel, 24));
    at(cylZ(r + 0.0014, 0.001, this.steel, 24), 0, 0, -side * 0.0028, g);
    g.add(cylZ(r * 0.86, 0.005, this.wheelMat, 24));
    if (spoked) {
      for (let k = 0; k < 4; k++) {
        const s = at(box(r * 1.6, r * 0.12, 0.0054, this.holeMat), 0, 0, 0, g);
        s.rotation.z = (k * Math.PI) / 4;
      }
    }
    g.add(cylZ(r * 0.25, 0.006, this.wheelMat, 12));
    this.smallWheels.push(at(g, x, r - this.rw, z, parent));
  }

  private buildFrame(): void {
    const F = this.group([0, 0, 0]);
    const { dark, steel, brass } = this;
    for (const s of [1, -1]) at(box(0.385, 0.03, 0.002, dark), 0.045, 0.006, s * 0.0165, F);
    for (const x of [0.078, -0.025, -0.092]) at(box(0.004, 0.02, 0.033, dark), x, 0.008, 0, F);
    at(box(0.05, 0.012, 0.034, dark), -0.165, 0.016, 0, F);
    at(box(0.004, 0.016, 0.094, dark), 0.238, 0.014, 0, F);
    at(box(0.012, 0.008, 0.008, steel), 0.246, 0.006, 0, F);
    at(box(0.004, 0.014, 0.09, dark), -0.189, 0.018, 0, F);
    at(box(0.03, 0.0015, 0.094, dark), 0.225, 0.023, 0, F);
    for (const x of LAYOUT.driverX) at(cylZ(0.0028, 2 * LAYOUT.wheelZ, steel, 10), x, 0, 0, F);
    // leading and trailing trucks
    const yS = LAYOUT.smallR - this.rw;
    for (const [x, w] of [
      [LAYOUT.leadX, 0.03],
      [LAYOUT.trailX, 0.042],
    ]) {
      at(cylZ(0.002, 2 * LAYOUT.wheelZ, steel, 8), x, yS, 0, F);
      at(box(w, 0.005, 0.034, dark), x, yS + 0.006, 0, F);
      for (const s of [1, -1]) this.smallWheel(F, x, s * LAYOUT.wheelZ, true);
    }
    // alcohol burner (drawing 23): three wick tubes in a row on one feed pipe, under the firebox
    const bx = LAYOUT.burnerX;
    at(cylX(0.0022, 0.066, brass, 10), bx - 0.006, 0.0075, 0, F);
    const flameMat = new THREE.MeshBasicMaterial({ color: 0x5aa2ff, transparent: true, opacity: 0.75, depthWrite: false });
    for (const dx of [-0.02, 0, 0.02]) {
      at(cylY(0.0042, 0.014, brass, 14), bx + dx, 0.014, 0, F);
      const flame = at(new THREE.Mesh(new THREE.ConeGeometry(0.0048, 0.014, 12), flameMat), bx + dx, 0.028, 0, F);
      flame.renderOrder = 3;
      this.flames.push(flame);
    }
    this.label('酒精燃烧器（3 根灯芯）', F, bx, 0.012, 0);
    // axle-driven feed pump and its eccentric
    at(cylX(0.003, 0.016, brass, 12), LAYOUT.pumpX, -0.004, -0.007, F);
    at(cylZ(0.006, 0.003, steel, 16), LAYOUT.driverX[1], 0, -0.007, F);
    this.label('轴动给水泵', F, LAYOUT.pumpX, -0.004, -0.007);
    // displacement lubricator on the front deck
    at(cylY(0.005, 0.012, brass, 12), 0.224, 0.03, 0.012, F);
    this.label('油壶', F, 0.224, 0.038, 0.012);
  }

  private buildCase(): void {
    const C = this.group([0, 0.11, 0]);
    const { steel, brass } = this;
    const black = this.shell();
    const graphite = this.shell(GRAPHITE, 0.3, 0.7);
    const { boilerY: by, caseR: R, fireboxX0: fx0, barrelX0: bx0, smokeboxX0: sx0, smokeboxX1: sx1, boardY, chimneyX } = LAYOUT;

    at(cylX(R, sx0 - fx0, black, 48), (fx0 + sx0) / 2, by, 0, C);
    at(box(bx0 - fx0, by - 0.018, 0.064, black), (fx0 + bx0) / 2, (by + 0.018) / 2, 0, C);
    for (const x of [-0.02, 0.03, 0.08, 0.13]) at(cylX(R + 0.0004, 0.0016, graphite, 48), x, by, 0, C);
    at(cylX(R + 0.0008, sx1 - sx0, graphite, 48), (sx0 + sx1) / 2, by, 0, C);
    const door = at(new THREE.Mesh(new THREE.SphereGeometry(R * 0.84, 24, 12), graphite), sx1, by, 0, C);
    door.scale.x = 0.22;
    at(cylX(0.0016, 0.004, steel, 10), sx1 + 0.007, by, 0, C);
    at(box(0.05, 0.022, 0.04, graphite), 0.168, 0.023, 0, C);
    this.label('烟箱', C, sx1 - 0.02, by + R, 0);
    this.label('锅炉外壳', C, 0.1, by + R, 0);

    const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0068, 0.02, 24, 1, true), this.shell(GRAPHITE, 0.3, 0.7));
    (stack.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    at(stack, chimneyX, 0.098, 0, C);
    at(cylY(0.0092, 0.003, graphite), chimneyX, 0.0895, 0, C);
    at(this.chimney, chimneyX, LAYOUT.chimneyTop, 0, C);
    // smoke collector around the chimney top
    for (const s of [1, -1]) at(box(0.042, 0.01, 0.001, graphite), chimneyX - 0.012, 0.107, s * 0.0105, C);
    at(box(0.001, 0.01, 0.021, graphite), chimneyX + 0.009, 0.107, 0, C);
    at(box(0.02, 0.001, 0.021, graphite), chimneyX - 0.023, 0.112, 0, C);
    this.label('烟囱 / 集烟装置', C, chimneyX, 0.114, 0);
    // feed water heater across the smokebox top, headlight
    at(cylZ(0.0058, 0.05, graphite, 20), 0.204, by + R + 0.0035, 0, C);
    this.label('给水加热器（外观件）', C, 0.204, by + R + 0.009, 0.02);
    at(cylX(0.0045, 0.006, black, 16), 0.2135, 0.102, 0, C);
    at(cylX(0.0038, 0.0005, new THREE.MeshBasicMaterial({ color: 0xfff3c4 }), 16), 0.2168, 0.102, 0, C);
    // combined steam dome and sand box casing, heavy-oil tank behind it
    at(box(0.05, 0.012, 0.022, black), 0.085, by + R + 0.004, 0, C);
    for (const x of [0.06, 0.11]) at(cylY(0.011, 0.012, black), x, by + R + 0.004, 0, C);
    this.label('汽包 / 砂箱', C, 0.085, by + R + 0.011, 0);
    at(halfCylX(0.014, 0.04, black), 0.02, by + R - 0.005, 0, C);
    this.label('重油箱（外观件）', C, 0.02, by + R + 0.009, 0);
    // safety valves, whistle, generator
    for (const s of [1, -1]) {
      at(cylY(0.0028, 0.008, brass, 12), -0.06, by + R + 0.003, s * 0.006, C);
      this.safety.push(at(new THREE.Object3D(), -0.06, by + R + 0.008, s * 0.006, C));
    }
    this.label('安全阀', C, -0.06, by + R + 0.008, 0);
    at(cylY(0.002, 0.009, brass, 10), -0.085, by + R + 0.003, 0.012, C);
    at(this.whistle, -0.085, by + R + 0.008, 0.012, C);
    at(cylX(0.004, 0.01, graphite, 12), -0.095, by + R + 0.003, -0.012, C);

    for (const s of [1, -1]) {
      at(cylX(0.0005, 0.19, steel, 6), 0.05, by + 0.012, s * (R + 0.0025), C);
      // running board, valance, air reservoir, smoke deflector
      at(box(0.335, 0.0015, 0.017, black), 0.05, boardY, s * 0.0385, C);
      at(box(0.335, 0.004, 0.0008, black), 0.05, boardY - 0.002, s * 0.047, C);
      at(cylX(0.005, 0.06, graphite, 16), 0.01, boardY - 0.0065, s * 0.0345, C);
      at(box(0.07, 0.062, 0.001, black), 0.19, boardY + 0.031, s * 0.046, C);
    }
    this.label('除烟板', C, 0.19, boardY + 0.062, 0.046);
    // air compressor (left) and feed pump (right) hung on the boiler sides
    at(cylY(0.006, 0.03, graphite, 16), 0.125, 0.05, -0.036, C);
    at(cylY(0.005, 0.024, graphite, 16), 0.125, 0.048, 0.036, C);
  }

  private buildInner(): void {
    const I = (this.inner = this.group([0, 0.05, 0]));
    I.add(this.internals);
    const N = this.internals;
    const L = LAYOUT;
    const { innerR: R, innerY: y, innerX0: x0, innerX1: x1, throatX: xt, flueR, flueY, flueZ, shPitch: sp, shHeaderX: hx } = L;
    const cut = L.crownY - y;
    const barrel = x1 - xt;
    const rear = xt - x0;
    const order = <T extends THREE.Object3D>(o: T, n: number): T => {
      o.renderOrder = n;
      return o;
    };

    // drum: full barrel ahead of the firebox, only the part above the firebox crown behind it
    const drum = this.casing(0xb87333, 0.8, 0.4);
    at(cylX(R, barrel, drum, 40), (xt + x1) / 2, y, 0, N);
    at(segX(R, cut, rear, drum), x0, y, 0, N);
    this.steamMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, depthWrite: false });
    order(at(cylX(R - 0.0012, barrel - 0.002, this.steamMat, 40), (xt + x1) / 2, y, 0, N), 1);
    order(at(segX(R - 0.0012, cut + 0.0008, rear - 0.001, this.steamMat), x0 + 0.001, y, 0, N), 1);
    this.waterMat = new THREE.MeshStandardMaterial({ color: 0x2f7fd6, transparent: true, opacity: 0.75, roughness: 0.2, depthWrite: false, clippingPlanes: [this.waterPlane] });
    const Rw = R - 0.0015;
    order(at(cylX(Rw, barrel - 0.003, this.waterMat, 40), (xt + x1) / 2, y, 0, N), 2);
    order(at(segX(Rw, cut + 0.001, rear - 0.0015, this.waterMat), x0 + 0.0015, y, 0, N), 2);

    // two flue tubes through the water space, from the firebox to the smokebox
    const flueMat = inside(0xd08a4a, 0.5);
    this.flueGasMat = new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.3, depthWrite: false });
    const tubeGeo = new THREE.CylinderGeometry(flueR, flueR, barrel + 0.002, 24, 1, true);
    tubeGeo.rotateZ(Math.PI / 2);
    for (const s of [1, -1]) {
      order(at(new THREE.Mesh(tubeGeo, flueMat), (xt + x1) / 2, flueY, s * flueZ, N), 3);
      this.flueGas.push(order(at(cylX(flueR - 0.0008, barrel, this.flueGasMat, 16), (xt + x1) / 2, flueY, s * flueZ, N), 3));
    }

    // superheater: steam from the upper header runs back down each flue, turns and returns to the lower header
    const pipe = inside(0xdfe5ea, 1);
    const rs = 0.0011;
    const xb = x1 - L.shLen;
    const bend = new THREE.TorusGeometry(sp, rs, 8, 14, Math.PI);
    for (const s of [1, -1]) {
      for (const d of [sp, -sp]) order(at(cylX(rs, hx - xb, pipe, 8), (hx + xb) / 2, flueY + d, s * flueZ, N), 4);
      const u = order(at(new THREE.Mesh(bend, pipe), xb, flueY, s * flueZ, N), 4);
      u.rotation.z = Math.PI / 2;
    }
    for (const d of [sp, -sp]) order(at(cylZ(rs * 1.5, 2 * flueZ + 0.004, pipe, 10), hx, flueY + d, 0, N), 4);
    // regulator and blower steam are led forward through the boiler to the two unions on the front tube plate
    order(at(cylX(0.0012, hx - x0 + 0.008, pipe, 8), (hx + x0 - 0.008) / 2, L.steamPipeY, 0, N), 4);
    order(at(cylY(0.0012, L.steamPipeY - flueY - sp, pipe, 8), hx, (L.steamPipeY + flueY + sp) / 2, 0, N), 4);
    order(at(cylX(0.001, 0.176 - x0 + 0.008, pipe, 8), (0.176 + x0 - 0.008) / 2, L.blowerPipeY, L.blowerPipeZ, N), 4);
    // superheater outlet down to the cylinders; blower nozzle and exhaust nozzle under the chimney
    order(at(cylX(rs, 0.005, pipe, 8), hx + 0.0025, flueY - sp, 0, N), 4);
    order(at(cylY(rs * 1.3, flueY - sp - 0.026, pipe, 8), hx + 0.005, (flueY - sp + 0.026) / 2, 0, N), 4);
    order(at(cylY(0.001, 0.011, pipe, 8), 0.176, L.blowerPipeY - 0.0055, L.blowerPipeZ, N), 4);
    order(at(cylX(0.001, 0.006, pipe, 8), 0.179, 0.046, -0.003, N), 4);
    order(at(cylY(0.0012, 0.008, pipe, 8), 0.182, 0.05, -0.002, N), 4);
    order(at(cylY(0.0022, L.blastY - 0.012, inside(0xc9a646, 0.9), 12), L.chimneyX, (L.blastY + 0.012) / 2, 0, N), 4);
    // backhead: water glass
    at(cylY(0.0013, 0.016, new THREE.MeshBasicMaterial({ color: 0x9fd3ff }), 8), x0 - 0.004, y, 0.012, N);

    // steam bubbles rise from the heated surfaces: the flue tubes and the firebox crown
    const pos = new Float32Array(BUBBLES * 3);
    for (let i = 0; i < BUBBLES; i++) {
      this.bubbleSeed[i] = Math.random();
      const x = x0 + 0.006 + Math.random() * (x1 - x0 - 0.012);
      let z: number;
      if (x < xt) {
        z = (Math.random() - 0.5) * 0.034;
        this.bubbleBase[i] = L.crownY + 0.001;
      } else {
        const dz = (Math.random() - 0.5) * 1.7 * flueR;
        z = (i % 2 ? 1 : -1) * flueZ + dz;
        this.bubbleBase[i] = flueY + Math.sqrt(flueR * flueR - dz * dz);
      }
      pos[i * 3] = x;
      pos[i * 3 + 1] = this.bubbleBase[i];
      pos[i * 3 + 2] = z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.bubbles = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.0022, transparent: true, opacity: 0.85, depthWrite: false }));
    this.bubbles.frustumCulled = false;
    this.bubbles.renderOrder = 3;
    N.add(this.bubbles);

    // water volume below a given height, allowing for the flues and the cut-away rear end
    const bottom = y - Rw;
    const crown = capArea(Rw, L.crownY + 0.001 - bottom);
    for (let i = 0; i <= LEVELS; i++) {
      const h = (i / LEVELS) * 2 * Rw;
      const circle = capArea(Rw, h);
      this.levelTable[i] = barrel * (circle - 2 * capArea(flueR, h - (flueY - flueR - bottom))) + rear * Math.max(0, circle - crown);
    }
    for (let i = 0; i <= LEVELS; i++) this.levelTable[i] /= this.levelTable[LEVELS];

    this.label('锅炉（水 / 蒸汽）', I, 0.06, y + R, 0, true);
    this.label('烟管 ×2', I, -0.012, flueY - flueR, flueZ, true);
    this.label('过热器：两根 U 形管，各插入一根烟管', I, 0.085, flueY + sp, flueZ, true);
    this.label('火室', I, -0.075, 0.04, 0, true);
    this.label('蒸汽干管 / 通风管（穿过锅炉）', I, -0.06, L.steamPipeY, 0, true);
    this.label('通风喷嘴 / 排汽喷口', I, 0.182, L.blastY, 0, true);
  }

  private buildCab(): void {
    const K = this.group([-0.05, 0.07, 0]);
    const black = this.shell();
    const x0 = LAYOUT.cabX0;
    const x1 = LAYOUT.fireboxX0;
    const len = x1 - x0;
    const cx = (x0 + x1) / 2;
    at(box(len, 0.002, 0.094, black), cx, 0.03, 0, K);
    at(box(0.001, 0.066, 0.094, black), x1, 0.063, 0, K);
    for (const s of [1, -1]) {
      at(box(len, 0.034, 0.001, black), cx, 0.047, s * 0.047, K);
      for (const x of [x0 + 0.003, cx, x1 - 0.003]) at(box(0.006, 0.02, 0.001, black), x, 0.074, s * 0.047, K);
      at(box(len, 0.012, 0.001, black), cx, 0.09, s * 0.047, K);
    }
    const roofMat = this.shell();
    roofMat.side = THREE.DoubleSide;
    const roof = at(halfCylX(0.05, len + 0.014, roofMat), cx - 0.004, 0.096, 0, K);
    roof.scale.y = 0.3;
    this.label('驾驶室', K, cx, 0.112, 0);
  }

  private buildMotion(): void {
    const p = this.sim.params;
    const g = p.gear;
    const e = p.engine;
    const r = e.stroke / 2;
    const { steel, dark } = this;
    const cylLen = e.stroke + PISTON_T + 2 * CLEAR_LEN + 0.004;
    const x0 = this.cylX0;
    const pivotX = g.conRod + g.dropArmX + g.unionLink - g.radiusRod;
    const cylMat = this.casing();
    const steamMat = () => new THREE.MeshBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.6, depthWrite: false });
    const m = this.partMats;

    for (const index of [0, 1]) {
      const s = index === 1 ? 1 : -1;
      const z = s * LAYOUT.cylZ;
      const W = this.group([0, 0, 0]);
      const Rods = this.group([0, 0, s * 0.03]);
      const D = this.group([0, 0, s * 0.06]);
      const V = this.group([0, 0, s * 0.1]);

      const wheels = LAYOUT.driverX.map((x) => this.driver(W, x, s * LAYOUT.wheelZ, r));

      // cylinder block, valve chest, slide bars, motion bracket
      at(cylX(e.bore / 2 + 0.0035, cylLen, cylMat), x0, 0, z, D);
      at(cylX(e.bore / 2 + 0.0045, 0.0012, steel), x0 + cylLen / 2, 0, z, D);
      at(box(0.032, 0.0095, 0.014, cylMat), x0, g.valveSpindleY, z, D);
      at(box(0.02, 0.012, 0.012, dark), x0, 0.004, s * 0.023, D);
      for (const y of [0.0052, -0.0052]) at(box(0.042, 0.0014, 0.004, steel), g.conRod, y, z, D);
      at(box(0.0015, 0.02, 0.02, dark), pivotX, 0.024, s * 0.027, D);
      at(cylZ(0.0012, 0.006, steel, 8), pivotX, g.valveSpindleY - g.leverUpper, s * 0.0395, D);
      const steam = [0, 1].map(() => at(cylX(e.bore / 2 - 0.0004, 1, steamMat(), 24), x0, 0, z, D));
      const chestSteam = at(box(0.029, 0.007, 0.011, steamMat()), x0, g.valveSpindleY, z, D);
      this.drains.push(at(new THREE.Object3D(), x0, -e.bore / 2 - 0.005, z, D));

      const links: Record<LinkName, Link> = {
        coupling: new Link(Rods, s * 0.0305, 0.004, 0.002, m.coupling),
        mainRod: new Link(D, s * 0.0345, 0.0045, 0.002, m.mainRod),
        pistonRod: new Link(D, z, 0.002, 0.002, m.crosshead),
        dropArm: new Link(D, s * 0.0385, 0.002, 0.0015, m.crosshead),
        returnCrank: new Link(V, s * 0.0385, 0.003, 0.0015, m.returnCrank),
        eccRod: new Link(V, s * 0.0405, 0.0025, 0.0015, m.eccRod),
        link: new Link(V, s * 0.0405, 0.004, 0.002, m.link),
        radiusRod: new Link(V, s * 0.0385, 0.002, 0.0015, m.radiusRod),
        lever: new Link(V, s * 0.0405, 0.002, 0.0015, m.lever),
        union: new Link(V, s * 0.0405, 0.002, 0.0015, m.union),
        spindle: new Link(V, z, 0.0015, 0.0015, m.valve),
      };
      const side: Side = {
        index,
        sign: s,
        wheels,
        links,
        crosshead: at(box(0.008, 0.009, 0.006, m.crosshead), 0, 0, z, D),
        piston: at(cylX(e.bore / 2 - 0.0002, PISTON_T, m.crosshead, 24), 0, 0, z, D),
        valve: at(box(0.0124, 0.004, 0.009, m.valve), 0, g.valveSpindleY, z, V),
        dieBlock: at(box(0.003, 0.003, 0.0026, m.radiusRod), 0, 0, s * 0.0405, V),
        steam,
        chestSteam,
      };
      this.sides.push(side);

      for (const name of ['coupling', 'mainRod', 'returnCrank', 'eccRod', 'link', 'radiusRod', 'lever', 'union'] as const) {
        this.labels.push({ text: PART_LABELS[name], anchor: links[name].mesh, kind: 'mech', side: s, color: PART_COLORS[name] });
      }
      this.labels.push({ text: PART_LABELS.crosshead, anchor: side.crosshead, kind: 'mech', side: s, color: PART_COLORS.crosshead });
      this.labels.push({ text: PART_LABELS.valve, anchor: side.valve, kind: 'mech', side: s, color: PART_COLORS.valve });
      this.labels.push({ text: '气缸', anchor: at(new THREE.Object3D(), x0, -e.bore / 2 - 0.004, z, D), kind: 'mech', side: s });
      if (s === 1) this.label('气缸与汽室', D, x0, g.valveSpindleY + 0.006, z);
    }
  }

  private buildTender(): void {
    const T = this.group([-0.1, 0, 0], this.tenderBase);
    T.rotation.y = this.tenderYaw;
    const black = this.shell();
    const { dark, steel, brass } = this;
    at(box(0.215, 0.05, 0.09, black), 0, 0.045, 0, T);
    at(box(0.215, 0.006, 0.05, dark), 0, 0.017, 0, T);
    for (const s of [1, -1]) at(box(0.11, 0.016, 0.001, black), 0.045, 0.078, s * 0.0445, T);
    at(box(0.001, 0.016, 0.09, black), -0.01, 0.078, 0, T);
    const coal = solid(0x0b0b0c, 0, 1);
    this.solidMats.push(coal);
    at(box(0.104, 0.01, 0.086, coal), 0.045, 0.074, 0, T);
    for (let i = 0; i < 14; i++) {
      const lump = at(box(0.012, 0.008, 0.012, coal), 0.045 + ((i * 37) % 90) / 1000 - 0.045, 0.08, ((i * 53) % 70) / 1000 - 0.035, T);
      lump.rotation.set(i, i * 2.1, i * 0.7);
    }
    at(cylY(0.008, 0.004, dark), -0.07, 0.072, 0, T);
    const yS = LAYOUT.smallR - this.rw;
    for (const bx of [0.058, -0.058]) {
      for (const s of [1, -1]) at(box(0.07, 0.006, 0.002, dark), bx, yS + 0.002, s * 0.0275, T);
      for (const dx of [0.025, -0.025]) {
        at(cylZ(0.002, 2 * LAYOUT.wheelZ, steel, 8), bx + dx, yS, 0, T);
        for (const s of [1, -1]) this.smallWheel(T, bx + dx, s * LAYOUT.wheelZ, false);
      }
    }
    // inside the tender body: water tank, alcohol tank, hand pump
    const liquid = (color: number) => new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.75, roughness: 0.2, depthWrite: false });
    this.tenderWater = at(box(0.2, 0.044, 0.084, liquid(0x2f7fd6)), 0, 0.045, 0, T);
    at(box(0.05, 0.03, 0.036, this.casing(0xc9a646, 0.9, 0.3)), 0.07, 0.052, 0.02, T);
    this.tenderFuel = at(box(0.046, 0.026, 0.032, liquid(0xb8e986)), 0.07, 0.052, 0.02, T);
    this.tenderFuel.renderOrder = 2;
    at(cylY(0.004, 0.03, brass, 12), 0.085, 0.05, -0.025, T);
    this.label('煤水车：水柜', T, -0.04, 0.072, 0);
    this.label('酒精箱', T, 0.07, 0.07, 0.02);
    this.label('手摇泵', T, 0.085, 0.068, -0.025);
  }

  /**
   * ghost = the whole engine is drawn as a pale glass model so that nothing hides the flow overlay:
   * shells, frame, wheels and motion all become translucent and stop writing depth.
   */
  setMode(mode: ViewMode, ghost: boolean): void {
    const see = mode !== 'normal' || ghost;
    for (const m of this.shellMats) {
      const opacity = mode === 'mech' ? 0.05 : ghost ? 0.1 : see ? 0.14 : 1;
      paint(m, ghost ? GHOST : m.userData.color, opacity, ghost ? 0.1 : m.userData.metalness);
    }
    for (const m of this.casingMats) paint(m, m.userData.color, ghost ? 0.2 : see ? 0.28 : 1, m.userData.metalness);
    for (const m of this.solidMats) paint(m, ghost ? GHOST : m.userData.color, ghost ? 0.2 : 1, ghost ? 0.1 : m.userData.metalness);
    for (const name of Object.keys(PART_COLORS) as PartName[]) {
      const color = mode === 'mech' ? PART_COLORS[name] : name === 'link' ? 0xc9a646 : 0xb9bec4;
      paint(this.partMats[name], ghost && mode !== 'mech' ? GHOST : color, ghost ? 0.3 : 1, mode === 'mech' || ghost ? 0.3 : 0.9);
    }
    this.waterMat.opacity = ghost ? 0.4 : 0.75;
    this.internals.visible = see && (mode !== 'mech' || ghost);
    this.tenderWater.visible = this.tenderFuel.visible = see;
  }

  setExplode(e: number): void {
    this.explode = e;
    for (const p of this.parts) p.group.position.copy(p.base).addScaledVector(p.offset, e);
  }

  /** Water level (as a fraction of the drum diameter) at which the drum holds the given volume fraction. */
  private levelFor(fill: number): number {
    const t = this.levelTable;
    let i = 1;
    while (i < LEVELS && t[i] < fill) i++;
    const span = t[i] - t[i - 1];
    return (i - 1 + (span > 0 ? Math.min(1, Math.max(0, (fill - t[i - 1]) / span)) : 0)) / LEVELS;
  }

  update(dt: number): void {
    const sim = this.sim;
    const g = sim.params.gear;
    const r = sim.params.engine.stroke / 2;
    const x0 = this.cylX0;
    const front = x0 + r + PISTON_T / 2 + CLEAR_LEN;
    const back = x0 - r - PISTON_T / 2 - CLEAR_LEN;
    const dx = LAYOUT.driverX;

    const roll = -sim.distance / LAYOUT.smallR;
    for (const w of this.smallWheels) w.rotation.z = roll;

    for (const s of this.sides) {
      const phi = sim.phi + (s.index * Math.PI) / 2;
      const pose = sim.gear.solve(phi, sim.controls.reverser);
      const l = s.links;
      for (const w of s.wheels) w.rotation.z = -phi;
      l.coupling.set({ x: dx[0] + pose.crankPin.x, y: pose.crankPin.y }, { x: dx[3] + pose.crankPin.x, y: pose.crankPin.y });
      l.mainRod.set(pose.crankPin, pose.crosshead);
      const px = pose.crosshead.x + g.pistonRod;
      l.pistonRod.set(pose.crosshead, { x: px, y: 0 });
      l.dropArm.set(pose.crosshead, pose.dropPin);
      l.returnCrank.set(pose.crankPin, pose.eccPin);
      l.eccRod.set(pose.eccPin, pose.linkTail);
      const k = (g.dieMax + 0.002) / g.linkTail;
      l.link.set(pose.linkTail, { x: pose.linkPivot.x + (pose.linkPivot.x - pose.linkTail.x) * k, y: pose.linkPivot.y + (pose.linkPivot.y - pose.linkTail.y) * k });
      l.radiusRod.set(pose.dieBlock, pose.leverMid);
      l.lever.set(pose.leverTop, pose.leverBottom);
      l.union.set(pose.leverBottom, pose.dropPin);
      l.spindle.set(pose.leverTop, { x: x0 + pose.valve, y: g.valveSpindleY });
      s.crosshead.position.x = pose.crosshead.x;
      s.piston.position.x = px;
      s.valve.position.x = x0 + pose.valve;
      s.dieBlock.position.set(pose.dieBlock.x, pose.dieBlock.y, s.dieBlock.position.z);
      s.dieBlock.rotation.z = pose.linkAngle;

      const ends: [number, number][] = [
        [px + PISTON_T / 2, front],
        [back, px - PISTON_T / 2],
      ];
      ends.forEach(([a, b], end) => {
        const P = sim.engine.P[s.index * 2 + end];
        const mesh = s.steam[end];
        mesh.position.x = (a + b) / 2;
        mesh.scale.x = Math.max(1e-4, b - a);
        const mm = mesh.material as THREE.MeshBasicMaterial;
        mm.color.setHSL(pressureHue(P) / 360, 0.85, 0.55);
        mm.opacity = 0.25 + 0.6 * pressureLevel(P);
      });
      const cm = s.chestSteam.material as THREE.MeshBasicMaterial;
      cm.color.setHSL(pressureHue(sim.engine.chestP) / 360, 0.85, 0.55);
      cm.opacity = 0.25 + 0.6 * pressureLevel(sim.engine.chestP);
    }

    // inner boiler: water level, water temperature, steam pressure, boiling
    const Rw = LAYOUT.innerR - 0.0015;
    const level = this.levelFor(Math.min(1, sim.boiler.fill));
    const surface = LAYOUT.innerY - Rw + level * 2 * Rw;
    this.waterPlane.constant = this.root.position.y + this.inner.position.y + surface;
    const hot = Math.min(1, Math.max(0, (sim.boiler.T - 293) / 130));
    this.waterMat.color.setHSL(0.6 - 0.12 * hot, 0.75, 0.42 + 0.16 * hot);
    this.steamMat.color.setHSL(pressureHue(sim.boiler.P) / 360, 0.7, 0.7);
    this.steamMat.opacity = 0.06 + 0.3 * pressureLevel(sim.boiler.P);
    const boiling = sim.boiler.gaugePressure > 2000 ? Math.min(1, sim.heatToWater / 600) : 0;
    const n = Math.round(BUBBLES * boiling);
    this.bubbles.geometry.setDrawRange(0, n);
    if (n > 0) {
      const pos = this.bubbles.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < n; i++) {
        const base = this.bubbleBase[i];
        let y = pos.getY(i) + (0.02 + 0.03 * this.bubbleSeed[i]) * dt;
        if (y > surface || y < base) y = base;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
    }
    // hot gas glowing in the flues
    for (const f of this.flueGas) f.visible = sim.lit;
    this.flueGasMat.opacity = 0.12 + 0.3 * Math.min(1, sim.fireGain);

    const wf = Math.max(0.001, sim.tenderWater / sim.params.feed.tenderCapacity);
    this.tenderWater.scale.y = wf;
    this.tenderWater.position.y = 0.023 + 0.022 * wf;
    const ff = Math.max(0.001, sim.fuel / sim.params.burner.fuelCapacity);
    this.tenderFuel.scale.y = ff;
    this.tenderFuel.position.y = 0.039 + 0.013 * ff;

    const fs = 0.5 + 1.3 * sim.fireGain;
    for (const f of this.flames) {
      f.visible = sim.lit;
      f.scale.y = fs;
      f.position.y = 0.021 + 0.007 * fs;
    }
  }
}
