import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { LocoSim } from '../sim/loco';
import { P_ATM } from '../sim/steam';
import type { Vec2 } from '../sim/valveGear';
import { pressureHue, pressureLevel } from './colors';

// Body layout of the D51 at 1:30, relative to the main (3rd) driving axle. Visual only.
const DRIVER_X = [0.1034, 0.0517, 0, -0.0517];
const SMALL_R = 0.0143;
const LOCO_SMALL_X = [0.185, -0.125];
const TENDER_X = -0.335;
const TENDER_WHEEL_X = [0.06, 0.03, -0.03, -0.06];
const BOILER_Y = 0.062;
const BOILER_R = 0.027;
const BOILER_X0 = -0.12;
const BOILER_X1 = 0.205;
const CHIMNEY = new THREE.Vector3(0.175, 0.108, 0);
const SAFETY = new THREE.Vector3(-0.04, 0.094, 0);
const WHISTLE = new THREE.Vector3(-0.1, 0.094, 0.012);
const WHEEL_Z = 0.0235;
const CYL_Z = 0.035;
const PISTON_T = 0.005;
const CLEAR_LEN = 0.002;
const UP = new THREE.Vector3(0, 1, 0);

function mat(color: number, metalness = 0.4, roughness = 0.55): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, metalness, roughness });
}

function box(lx: number, ly: number, lz: number, m: THREE.Material): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(lx, ly, lz), m);
}

function cylX(r: number, len: number, m: THREE.Material, seg = 32): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateZ(Math.PI / 2);
  return new THREE.Mesh(g, m);
}

function cylZ(r: number, len: number, m: THREE.Material, seg = 32): THREE.Mesh {
  const g = new THREE.CylinderGeometry(r, r, len, seg);
  g.rotateX(Math.PI / 2);
  return new THREE.Mesh(g, m);
}

function at<T extends THREE.Object3D>(o: T, x: number, y: number, z: number, parent: THREE.Object3D): T {
  o.position.set(x, y, z);
  parent.add(o);
  return o;
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

interface Side {
  index: number;
  wheels: THREE.Object3D[];
  coupling: Link;
  mainRod: Link;
  pistonRod: Link;
  dropArm: Link;
  returnCrank: Link;
  eccRod: Link;
  link: Link;
  radiusRod: Link;
  lever: Link;
  union: Link;
  spindle: Link;
  crosshead: THREE.Mesh;
  piston: THREE.Mesh;
  valve: THREE.Mesh;
  steam: THREE.Mesh[];
  drainPos: THREE.Vector3;
}

interface Puff {
  sprite: THREE.Sprite;
  vel: THREE.Vector3;
  age: number;
  life: number;
  size: number;
  grow: number;
}

export class LocoView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly orbit: OrbitControls;
  private readonly loco = new THREE.Group();
  private readonly tender = new THREE.Group();
  private readonly sides: Side[] = [];
  private readonly smallWheels: THREE.Object3D[] = [];
  private readonly shells: THREE.MeshStandardMaterial[] = [];
  private readonly waterPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  private readonly chestSteam: THREE.Mesh[] = [];
  private readonly flame: THREE.Mesh;
  private readonly puffs: Puff[] = [];
  private readonly puffTexture: THREE.Texture;
  private heading = 0;
  private lastBeat = 0;
  private emitDebt = 0;
  private readonly rw: number;
  private readonly trackR: number;

  constructor(
    private readonly container: HTMLElement,
    private readonly sim: LocoSim,
  ) {
    this.rw = sim.params.chassis.wheelDia / 2;
    this.trackR = sim.params.track.radius;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.localClippingEnabled = true;
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0xbcd6ea);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x556644, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(3, 6, 4);
    this.scene.add(sun);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.01, 60);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = false;
    this.orbit.minDistance = 0.12;
    this.orbit.maxDistance = 6;
    this.orbit.maxPolarAngle = Math.PI / 2 - 0.02;

    this.puffTexture = this.makePuffTexture();
    this.buildTrack();
    this.flame = this.buildLoco();
    this.buildTender();
    this.scene.add(this.loco, this.tender);

    this.heading = this.placeTrain();
    this.orbit.target.copy(this.loco.position).add(new THREE.Vector3(0, 0.04, 0));
    this.camera.position.copy(this.orbit.target).add(new THREE.Vector3(0.62, 0.2, -0.2));
    this.orbit.update();

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  setXray(on: boolean): void {
    for (const m of this.shells) {
      m.transparent = on;
      m.opacity = on ? 0.2 : 1;
      m.depthWrite = !on;
      m.needsUpdate = true;
    }
  }

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private makePuffTexture(): THREE.Texture {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,0.9)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }

  private buildTrack(): void {
    const R = this.trackR;
    const ground = new THREE.Mesh(new THREE.CircleGeometry(R + 8, 64), new THREE.MeshStandardMaterial({ color: 0x6f9460, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.012;
    const ballast = new THREE.Mesh(new THREE.RingGeometry(R - 0.055, R + 0.055, 180), new THREE.MeshStandardMaterial({ color: 0x8b857b, roughness: 1 }));
    ballast.rotation.x = -Math.PI / 2;
    ballast.position.y = -0.0065;
    this.scene.add(ground, ballast);
    const railMat = mat(0xb9a36b, 0.8, 0.35);
    for (const r of [R - 0.0225, R + 0.0225]) {
      const rail = new THREE.Mesh(new THREE.TorusGeometry(r, 0.0015, 6, 360), railMat);
      rail.rotation.x = Math.PI / 2;
      rail.position.y = -0.0015;
      this.scene.add(rail);
    }
    const n = Math.floor((2 * Math.PI * R) / 0.025);
    const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(0.075, 0.004, 0.009), new THREE.MeshStandardMaterial({ color: 0x4a3b2c, roughness: 1 }), n);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < n; i++) {
      const th = (i / n) * 2 * Math.PI;
      q.setFromAxisAngle(UP, th);
      m.compose(new THREE.Vector3(R * Math.cos(th), -0.005, -R * Math.sin(th)), q, one);
      sleepers.setMatrixAt(i, m);
    }
    this.scene.add(sleepers);
  }

  private shell(color: number, metalness = 0.4, roughness = 0.55): THREE.MeshStandardMaterial {
    const m = mat(color, metalness, roughness);
    this.shells.push(m);
    return m;
  }

  private wheel(r: number, parent: THREE.Object3D, x: number, y: number, z: number, crank: number): THREE.Object3D {
    const g = new THREE.Group();
    const side = Math.sign(z);
    g.add(cylZ(r, 0.005, mat(0x23262a, 0.5, 0.5)));
    at(cylZ(r + 0.0015, 0.0012, mat(0x23262a, 0.5, 0.5)), 0, 0, -side * 0.003, g);
    at(cylZ(r * 0.82, 0.0052, mat(0x8c1d18, 0.2, 0.7)), 0, 0, side * 0.0002, g);
    at(box(r * 1.6, r * 0.14, 0.0056, mat(0x23262a)), 0, 0, 0, g);
    at(box(r * 0.14, r * 1.6, 0.0056, mat(0x23262a)), 0, 0, 0, g);
    if (crank > 0) {
      at(box(r * 0.5, r * 1.1, 0.0058, mat(0x23262a)), -r * 0.52, 0, 0, g);
      at(cylZ(0.0022, 0.012, mat(0xc8ccd0, 0.9, 0.3), 12), crank, 0, side * 0.006, g);
    }
    return at(g, x, y, z, parent);
  }

  private buildLoco(): THREE.Mesh {
    const L = this.loco;
    const p = this.sim.params;
    const black = this.shell(0x1b1d20, 0.5, 0.45);
    const dark = mat(0x2a2d31);
    const steel = mat(0xc4c9ce, 0.9, 0.3);
    const brass = mat(0xc9a646, 0.9, 0.3);

    // frame, running boards, boiler, cab
    at(box(0.34, 0.016, 0.03, dark), 0.03, 0.006, 0, L);
    at(box(0.36, 0.002, 0.088, dark), 0.03, 0.031, 0, L);
    at(box(0.012, 0.014, 0.088, dark), 0.214, 0.012, 0, L);
    const len = BOILER_X1 - BOILER_X0;
    at(cylX(BOILER_R, len, black, 48), (BOILER_X0 + BOILER_X1) / 2, BOILER_Y, 0, L);
    at(cylX(BOILER_R * 0.86, 0.004, steel, 48), BOILER_X1 + 0.002, BOILER_Y, 0, L);
    const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.0075, 0.0065, 0.022, 24, 1, true), mat(0x1b1d20, 0.5, 0.45));
    (chimney.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
    at(chimney, CHIMNEY.x, CHIMNEY.y - 0.011, 0, L);
    at(box(0.09, 0.012, 0.022, black), 0.05, BOILER_Y + BOILER_R + 0.003, 0, L);
    at(new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.008, 12), brass), SAFETY.x, SAFETY.y - 0.004, 0.006, L);
    at(new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.008, 12), brass), SAFETY.x, SAFETY.y - 0.004, -0.006, L);
    at(new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.008, 12), brass), WHISTLE.x, WHISTLE.y - 0.004, WHISTLE.z, L);
    at(box(0.075, 0.07, 0.088, black), -0.165, 0.066, 0, L);
    at(box(0.09, 0.003, 0.096, black), -0.165, 0.103, 0, L);
    for (const s of [1, -1]) at(box(0.06, 0.05, 0.0012, black), 0.178, 0.057, s * 0.043, L);
    at(box(0.08, 0.004, 0.06, dark), 0.25, -0.004, 0, L);

    // boiler internals, seen in cutaway view: water, flue, burner flame
    const water = cylX(BOILER_R - 0.002, len - 0.07, new THREE.MeshStandardMaterial({ color: 0x2f7fd6, transparent: true, opacity: 0.75, roughness: 0.2, clippingPlanes: [this.waterPlane] }), 48);
    at(water, (BOILER_X0 + BOILER_X1) / 2 - 0.03, BOILER_Y, 0, L);
    at(cylX(0.008, len - 0.06, mat(0x4a3a30, 0.3, 0.8), 16), (BOILER_X0 + BOILER_X1) / 2 - 0.025, BOILER_Y - 0.012, 0, L);
    const flame = at(box(0.05, 0.012, 0.03, new THREE.MeshBasicMaterial({ color: 0x66aaff, transparent: true, opacity: 0.85 })), -0.095, 0.025, 0, L);

    // small wheels
    for (const x of LOCO_SMALL_X) {
      for (const s of [1, -1]) this.smallWheels.push(this.wheel(SMALL_R, L, x, SMALL_R - this.rw, s * WHEEL_Z, 0));
      at(cylZ(0.002, 2 * WHEEL_Z, steel, 8), x, SMALL_R - this.rw, 0, L);
    }
    for (const x of DRIVER_X) at(cylZ(0.0028, 2 * WHEEL_Z, steel, 8), x, 0, 0, L);

    // cylinders, valve chests and motion, both sides
    const g = p.gear;
    const e = p.engine;
    const r = e.stroke / 2;
    const cylX0 = g.conRod + g.pistonRod;
    const cylLen = e.stroke + PISTON_T + 2 * CLEAR_LEN + 0.004;
    const rod = mat(0xb9bec4, 0.9, 0.3);
    for (const index of [0, 1]) {
      const s = index === 1 ? 1 : -1;
      const z = s * CYL_Z;
      at(cylX(e.bore / 2 + 0.003, cylLen, this.shell(0x1b1d20, 0.5, 0.45)), cylX0, 0, z, L);
      at(box(0.03, 0.009, 0.014, this.shell(0x1b1d20, 0.5, 0.45)), cylX0, g.valveSpindleY, z, L);
      at(box(0.04, 0.0015, 0.004, steel), g.conRod, 0.005, z, L);
      at(box(0.04, 0.0015, 0.004, steel), g.conRod, -0.005, z, L);
      const wheels = DRIVER_X.map((x) => this.wheel(this.rw, L, x, 0, s * WHEEL_Z, r));
      const steamMat = () => new THREE.MeshBasicMaterial({ color: 0x4488ff, transparent: true, opacity: 0.6, depthWrite: false });
      const steam = [0, 1].map(() => at(cylX(e.bore / 2 - 0.0004, 1, steamMat(), 24), cylX0, 0, z, L));
      this.chestSteam.push(at(box(0.027, 0.0065, 0.011, steamMat()), cylX0, g.valveSpindleY, z, L));
      this.sides.push({
        index,
        wheels,
        coupling: new Link(L, s * 0.0305, 0.004, 0.002, rod),
        mainRod: new Link(L, s * 0.0345, 0.0045, 0.002, rod),
        pistonRod: new Link(L, z, 0.002, 0.002, rod),
        dropArm: new Link(L, s * 0.0385, 0.002, 0.0015, rod),
        returnCrank: new Link(L, s * 0.0385, 0.003, 0.0015, rod),
        eccRod: new Link(L, s * 0.0405, 0.0025, 0.0015, rod),
        link: new Link(L, s * 0.0405, 0.004, 0.002, brass),
        radiusRod: new Link(L, s * 0.0385, 0.002, 0.0015, rod),
        lever: new Link(L, s * 0.0405, 0.002, 0.0015, rod),
        union: new Link(L, s * 0.0405, 0.002, 0.0015, rod),
        spindle: new Link(L, z, 0.0015, 0.0015, rod),
        crosshead: at(box(0.008, 0.008, 0.006, steel), 0, 0, z, L),
        piston: at(cylX(e.bore / 2 - 0.0002, PISTON_T, steel, 24), 0, 0, z, L),
        valve: at(box(0.0096, 0.004, 0.009, brass), 0, g.valveSpindleY, z, L),
        steam,
        drainPos: new THREE.Vector3(cylX0, -0.012, z),
      });
    }
    return flame;
  }

  private buildTender(): void {
    const T = this.tender;
    const black = this.shell(0x1b1d20, 0.5, 0.45);
    at(box(0.19, 0.05, 0.086, black), 0, 0.045, 0, T);
    at(box(0.19, 0.008, 0.03, mat(0x2a2d31)), 0, 0.012, 0, T);
    at(box(0.09, 0.012, 0.07, mat(0x111111, 0, 1)), 0.03, 0.074, 0, T);
    for (const x of TENDER_WHEEL_X) for (const s of [1, -1]) this.smallWheels.push(this.wheel(SMALL_R, T, x, SMALL_R - this.rw, s * WHEEL_Z, 0));
  }

  private pathPoint(s: number, out: THREE.Vector3): number {
    const th = s / this.trackR;
    out.set(this.trackR * Math.cos(th), this.rw, -this.trackR * Math.sin(th));
    return th + Math.PI / 2;
  }

  private placeTrain(): number {
    const s = this.sim.distance;
    const heading = this.pathPoint(s, this.loco.position);
    this.loco.rotation.y = heading;
    this.tender.rotation.y = this.pathPoint(s + TENDER_X, this.tender.position);
    return heading;
  }

  /** Circular-segment height (as a fraction of the diameter) holding the given area fraction. */
  private levelFor(fill: number): number {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 18; i++) {
      const h = (lo + hi) / 2;
      const th = 2 * Math.acos(1 - 2 * h);
      if ((th - Math.sin(th)) / (2 * Math.PI) < fill) lo = h;
      else hi = h;
    }
    return (lo + hi) / 2;
  }

  private emit(local: THREE.Vector3, vel: THREE.Vector3, size: number, life: number, grow: number, from: THREE.Object3D = this.loco): void {
    let p = this.puffs.find((q) => q.age >= q.life);
    if (!p) {
      if (this.puffs.length >= 260) return;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.puffTexture, transparent: true, depthWrite: false }));
      p = { sprite, vel: new THREE.Vector3(), age: 0, life: 0, size: 0, grow: 0 };
      this.puffs.push(p);
      this.scene.add(sprite);
    }
    from.localToWorld(p.sprite.position.copy(local));
    p.vel.copy(vel).applyQuaternion(from.quaternion);
    p.vel.x += (Math.random() - 0.5) * 0.05;
    p.vel.z += (Math.random() - 0.5) * 0.05;
    p.age = 0;
    p.life = life * (0.7 + 0.6 * Math.random());
    p.size = size;
    p.grow = grow;
    p.sprite.visible = true;
  }

  private updatePuffs(dt: number): void {
    const sim = this.sim;
    const hot = sim.boiler.P > P_ATM + 5000;
    // exhaust beats: four per revolution
    const beat = Math.floor(sim.phi / (Math.PI / 2));
    if (beat !== this.lastBeat) {
      this.lastBeat = beat;
      const n = Math.min(5, Math.round(sim.exhaustFlow * 2.5e4));
      for (let i = 0; i < n; i++) this.emit(CHIMNEY, new THREE.Vector3(0, 0.5 + 0.2 * Math.random(), 0), 0.02, 1.6, 0.09);
    }
    this.emitDebt += dt;
    if (this.emitDebt > 0.03) {
      this.emitDebt = 0;
      if (hot && sim.blowerFlow > 0) this.emit(CHIMNEY, new THREE.Vector3(0, 0.35, 0), 0.012, 0.8, 0.05);
      if (sim.safetyOpen) for (const z of [0.006, -0.006]) this.emit(new THREE.Vector3(SAFETY.x, SAFETY.y, z), new THREE.Vector3(0, 1.1, 0), 0.01, 0.7, 0.12);
      if (hot && sim.controls.whistle) this.emit(WHISTLE, new THREE.Vector3(0, 0.8, 0), 0.008, 0.5, 0.08);
      if (sim.controls.drains && sim.drainFlow > 1e-6) for (const s of this.sides) this.emit(s.drainPos, new THREE.Vector3(0.25, -0.02, Math.sign(s.drainPos.z) * 0.35), 0.012, 0.7, 0.1);
    }
    for (const p of this.puffs) {
      if (p.age >= p.life) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.sprite.visible = false;
        continue;
      }
      p.vel.multiplyScalar(Math.exp(-1.5 * dt));
      p.vel.y += 0.05 * dt;
      p.sprite.position.addScaledVector(p.vel, dt);
      const k = p.age / p.life;
      p.sprite.scale.setScalar(p.size + p.grow * p.age);
      p.sprite.material.opacity = 0.75 * (1 - k);
    }
  }

  /** Read the simulation state and draw one frame; dt is wall-clock seconds, used only for effects. */
  update(dt: number): void {
    const sim = this.sim;
    const g = sim.params.gear;
    const e = sim.params.engine;
    const r = e.stroke / 2;

    const heading = this.placeTrain();
    const turn = heading - this.heading;
    this.heading = heading;
    const target = new THREE.Vector3().copy(this.loco.position);
    target.y += 0.04;
    const offset = this.camera.position.clone().sub(this.orbit.target).applyAxisAngle(UP, turn);
    this.orbit.target.copy(target);
    this.camera.position.copy(target).add(offset);
    this.orbit.update();

    const roll = -sim.distance / SMALL_R;
    for (const w of this.smallWheels) w.rotation.z = roll;

    const cylX0 = g.conRod + g.pistonRod;
    const front = cylX0 + r + PISTON_T / 2 + CLEAR_LEN;
    const back = cylX0 - r - PISTON_T / 2 - CLEAR_LEN;
    for (const s of this.sides) {
      const phi = sim.phi + (s.index * Math.PI) / 2;
      const pose = sim.gear.solve(phi, sim.controls.reverser);
      for (const w of s.wheels) w.rotation.z = -phi;
      s.coupling.set({ x: DRIVER_X[0] + pose.crankPin.x, y: pose.crankPin.y }, { x: DRIVER_X[3] + pose.crankPin.x, y: pose.crankPin.y });
      s.mainRod.set(pose.crankPin, pose.crosshead);
      const px = pose.crosshead.x + g.pistonRod;
      s.pistonRod.set(pose.crosshead, { x: px, y: 0 });
      s.dropArm.set(pose.crosshead, pose.dropPin);
      s.returnCrank.set(pose.crankPin, pose.eccPin);
      s.eccRod.set(pose.eccPin, pose.linkTail);
      const k = (g.dieMax + 0.002) / g.linkTail;
      s.link.set(pose.linkTail, { x: pose.linkPivot.x + (pose.linkPivot.x - pose.linkTail.x) * k, y: pose.linkPivot.y + (pose.linkPivot.y - pose.linkTail.y) * k });
      s.radiusRod.set(pose.dieBlock, pose.leverMid);
      s.lever.set(pose.leverTop, pose.leverBottom);
      s.union.set(pose.leverBottom, pose.dropPin);
      s.spindle.set(pose.leverTop, { x: cylX0 + pose.valve, y: g.valveSpindleY });
      s.crosshead.position.x = pose.crosshead.x;
      s.piston.position.x = px;
      s.valve.position.x = cylX0 + pose.valve;

      const ends: [number, number][] = [
        [px + PISTON_T / 2, front],
        [back, px - PISTON_T / 2],
      ];
      ends.forEach(([x0, x1], end) => {
        const P = sim.engine.P[s.index * 2 + end];
        const m = s.steam[end];
        m.position.x = (x0 + x1) / 2;
        m.scale.x = Math.max(1e-4, x1 - x0);
        const mm = m.material as THREE.MeshBasicMaterial;
        mm.color.setHSL(pressureHue(P) / 360, 0.85, 0.55);
        mm.opacity = 0.25 + 0.6 * pressureLevel(P);
      });
    }
    for (const c of this.chestSteam) {
      const mm = c.material as THREE.MeshBasicMaterial;
      mm.color.setHSL(pressureHue(sim.engine.chestP) / 360, 0.85, 0.55);
      mm.opacity = 0.25 + 0.6 * pressureLevel(sim.engine.chestP);
    }

    this.waterPlane.constant = this.rw + BOILER_Y - (BOILER_R - 0.002) + this.levelFor(Math.min(1, sim.boiler.fill)) * 2 * (BOILER_R - 0.002);
    this.flame.visible = sim.lit;
    this.flame.scale.y = 0.4 + 1.2 * sim.fireGain;

    this.updatePuffs(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
