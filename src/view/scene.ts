import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { LocoSim } from '../sim/loco';
import { P_ATM } from '../sim/steam';
import { cssHex } from './colors';
import { FLOW_COLORS, FlowOverlay, type FlowKind } from './flow';
import { LocoModel, type ViewMode } from './locoModel';

const UP = new THREE.Vector3(0, 1, 0);
/** [normal, while the flow overlay is on]: the overlay is drawn on a dark, plain scene */
const SKY = [0xbcd6ea, 0x10151c];
const GROUND = [0x6f9460, 0x171d24];
const BALLAST = [0x8b857b, 0x2a3038];
const NARROW = 520;

interface LabelItem {
  el: HTMLElement;
  anchor: THREE.Object3D;
  wanted: () => boolean;
  /** live text, refreshed a few times per second */
  text?: () => string;
  w: number;
  h: number;
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
  private readonly model: LocoModel;
  private readonly flow: FlowOverlay;
  private readonly labelLayer = document.createElement('div');
  private readonly labelItems: LabelItem[] = [];
  private readonly placed: number[] = [];
  private readonly groundMat = new THREE.MeshStandardMaterial({ color: GROUND[0], roughness: 1 });
  private readonly ballastMat = new THREE.MeshStandardMaterial({ color: BALLAST[0], roughness: 1 });
  private frame = 0;
  private readonly puffs: Puff[] = [];
  private readonly puffTexture: THREE.Texture;
  private readonly rw: number;
  private readonly trackR: number;
  private heading = 0;
  private lastBeat = 0;
  private emitDebt = 0;
  private mode: ViewMode = 'normal';
  private showFlow = false;
  private showLabels = false;
  private inset = 0;
  private sideInset = 0;
  /** usable label width [px]; below NARROW the numeric flow labels would bury the engine */
  private labelWidth = 1000;

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
    this.labelLayer.className = 'labels';
    this.labelLayer.style.display = 'none';
    container.appendChild(this.labelLayer);

    this.scene.background = new THREE.Color(SKY[0]);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x667755, 1.9));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(3, 6, 4);
    this.scene.add(sun);

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.01, 60);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = false;
    this.orbit.minDistance = 0.1;
    this.orbit.maxDistance = 6;
    this.orbit.maxPolarAngle = Math.PI / 2 - 0.02;

    this.puffTexture = this.makePuffTexture();
    this.buildTrack();
    this.model = new LocoModel(sim, this.trackR);
    this.flow = new FlowOverlay(sim, this.model);
    this.flow.group.visible = false;
    this.model.root.add(this.flow.group);
    this.scene.add(this.model.root);
    const item = (className: string, color: number | undefined, anchor: THREE.Object3D, wanted: () => boolean, text?: () => string): HTMLElement => {
      const el = document.createElement('span');
      el.className = className;
      if (color !== undefined) el.style.borderColor = cssHex(color);
      this.labelLayer.appendChild(el);
      this.labelItems.push({ el, anchor, wanted, text, w: 0, h: 0 });
      return el;
    };
    // flow labels first: they get their place before the part names
    for (const label of this.flow.labels) {
      item('flow', FLOW_COLORS[label.kind], label.anchor, () => this.flow.group.visible && this.labelWidth >= NARROW && this.flow.shows(label.kind), label.text);
    }
    for (const label of this.model.labels) {
      const wanted =
        label.kind === 'mech'
          ? () => this.showLabels && this.mode === 'mech' && (label.side === 0 || label.side === this.camSide)
          : () => this.showLabels && this.mode !== 'mech' && (!label.inner || this.model.internalsVisible);
      item(label.kind, label.color, label.anchor, wanted).textContent = label.text;
    }

    this.heading = this.placeTrain();
    this.orbit.target.copy(this.model.root.position).add(new THREE.Vector3(0, 0.035, 0));
    // stand further back on a narrow (portrait) view so that the whole engine stays in the picture
    const aspect = (container.clientWidth || 1) / (container.clientHeight || 1);
    this.camera.position.copy(this.orbit.target).addScaledVector(new THREE.Vector3(0.5, 0.2, -0.3), Math.min(2.8, Math.max(1, 1.65 / aspect)));
    this.orbit.update();

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  setView(mode: ViewMode, flow: boolean, labels: boolean): void {
    this.mode = mode;
    this.showFlow = flow;
    this.showLabels = labels;
    this.model.setMode(mode, flow);
    const k = flow ? 1 : 0;
    (this.scene.background as THREE.Color).setHex(SKY[k]);
    this.groundMat.color.setHex(GROUND[k]);
    this.ballastMat.color.setHex(BALLAST[k]);
  }

  /** Show or hide one medium of the flow overlay. */
  setFlowKind(kind: FlowKind, on: boolean): void {
    this.flow.setKind(kind, on);
  }

  setExplode(e: number): void {
    this.model.setExplode(e);
  }

  /** Keep the engine clear of an overlay covering the bottom of the view. */
  setBottomInset(px: number): void {
    this.inset = px;
    this.resize();
  }

  /** Width of the panels covering the left and right edges of the view; labels stay between them. */
  setSideInset(px: number): void {
    this.sideInset = px;
  }

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.setViewOffset(w, h, 0, this.inset / 2, w, h);
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
    const ground = new THREE.Mesh(new THREE.CircleGeometry(R + 8, 64), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.012;
    const ballast = new THREE.Mesh(new THREE.RingGeometry(R - 0.055, R + 0.055, 180), this.ballastMat);
    ballast.rotation.x = -Math.PI / 2;
    ballast.position.y = -0.0065;
    this.scene.add(ground, ballast);
    const railMat = new THREE.MeshStandardMaterial({ color: 0xb9a36b, metalness: 0.8, roughness: 0.35 });
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

  private placeTrain(): number {
    const th = this.sim.distance / this.trackR;
    const root = this.model.root;
    root.position.set(this.trackR * Math.cos(th), this.rw, -this.trackR * Math.sin(th));
    root.rotation.y = th + Math.PI / 2;
    root.updateMatrixWorld(true);
    return root.rotation.y;
  }

  private emit(from: THREE.Object3D, vx: number, vy: number, vz: number, size: number, life: number, grow: number): void {
    let p = this.puffs.find((q) => q.age >= q.life);
    if (!p) {
      if (this.puffs.length >= 260) return;
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.puffTexture, transparent: true, depthWrite: false }));
      p = { sprite, vel: new THREE.Vector3(), age: 0, life: 0, size: 0, grow: 0 };
      this.puffs.push(p);
      this.scene.add(sprite);
    }
    from.getWorldPosition(p.sprite.position);
    p.vel.set(vx, vy, vz).applyQuaternion(this.model.root.quaternion);
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
    const m = this.model;
    const hot = sim.boiler.P > P_ATM + 5000;
    // exhaust beats: four per revolution
    const beat = Math.floor(sim.phi / (Math.PI / 2));
    if (beat !== this.lastBeat) {
      this.lastBeat = beat;
      const n = Math.min(5, Math.round(sim.exhaustFlow * 2.5e4));
      for (let i = 0; i < n; i++) this.emit(m.chimney, 0, 0.5 + 0.2 * Math.random(), 0, 0.02, 1.6, 0.09);
    }
    this.emitDebt += dt;
    if (this.emitDebt > 0.03) {
      this.emitDebt = 0;
      if (hot && sim.blowerFlow > 0) this.emit(m.chimney, 0, 0.35, 0, 0.012, 0.8, 0.05);
      if (sim.safetyOpen) for (const s of m.safety) this.emit(s, 0, 1.1, 0, 0.01, 0.7, 0.12);
      if (hot && sim.controls.whistle) this.emit(m.whistle, 0, 0.8, 0, 0.008, 0.5, 0.08);
      if (sim.controls.drains && sim.drainFlow > 1e-6) m.drains.forEach((d, i) => this.emit(d, 0.25, -0.02, (i === 0 ? -1 : 1) * 0.35, 0.012, 0.7, 0.1));
    }
    // steam and smoke would only haze the flow overlay
    const fade = this.showFlow ? 0 : 0.75;
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
      p.sprite.scale.setScalar(p.size + p.grow * p.age);
      p.sprite.material.opacity = fade * (1 - p.age / p.life);
    }
  }

  private camSide = 1;

  /** Place the HTML labels over their anchors; a label that would cover an earlier one is moved up. */
  private updateLabels(): void {
    const show = this.showLabels || this.flow.group.visible;
    this.labelLayer.style.display = show ? '' : 'none';
    if (!show) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const left = this.sideInset;
    const right = w - this.sideInset;
    this.labelWidth = right - left;
    this.camSide = Math.sign(this.model.root.worldToLocal(this.camera.position.clone()).z);
    const refresh = this.frame++ % 10 === 0;
    const p = new THREE.Vector3();
    const placed = this.placed;
    placed.length = 0;
    for (const it of this.labelItems) {
      const wanted = it.wanted();
      if (wanted) it.anchor.getWorldPosition(p).project(this.camera);
      if (!wanted || p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1) {
        it.el.style.display = 'none';
        continue;
      }
      it.el.style.display = '';
      if (it.text && (refresh || it.w === 0)) {
        const text = it.text();
        if (text !== it.el.textContent) {
          it.el.textContent = text;
          it.w = 0;
        }
      }
      if (it.w === 0) {
        it.w = it.el.offsetWidth;
        it.h = it.el.offsetHeight;
      }
      const x = Math.min(right - it.w, Math.max(left, ((p.x + 1) / 2) * w - it.w / 2));
      let y = ((1 - p.y) / 2) * h - it.h * 1.35;
      for (let tries = 0; tries < 12; tries++) {
        let hit = false;
        for (let i = 0; i < placed.length; i += 4) {
          if (x < placed[i + 2] && x + it.w > placed[i] && y < placed[i + 3] && y + it.h > placed[i + 1]) {
            y = placed[i + 1] - it.h - 2;
            hit = true;
          }
        }
        if (!hit) break;
      }
      placed.push(x, y, x + it.w, y + it.h);
      it.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  }

  /** Read the simulation state and draw one frame; dt is wall-clock seconds, used only for effects. */
  update(dt: number): void {
    const heading = this.placeTrain();
    const turn = heading - this.heading;
    this.heading = heading;
    const target = this.model.root.position.clone();
    target.y += 0.035;
    const offset = this.camera.position.clone().sub(this.orbit.target).applyAxisAngle(UP, turn);
    this.orbit.target.copy(target);
    this.camera.position.copy(target).add(offset);
    this.orbit.update();

    this.model.update(dt);
    // pipes are laid out for the assembled engine
    this.flow.group.visible = this.showFlow && this.model.explode < 0.02;
    if (this.flow.group.visible) this.flow.update(dt);
    this.model.root.updateMatrixWorld(true);
    this.updatePuffs(dt);
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
  }
}
