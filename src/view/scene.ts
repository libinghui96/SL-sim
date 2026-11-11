import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { LocoSim } from '../sim/loco';
import { P_ATM } from '../sim/steam';
import { cssHex } from './colors';
import { FlowOverlay } from './flow';
import { LocoModel, type ViewMode } from './locoModel';

const UP = new THREE.Vector3(0, 1, 0);

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
  private readonly labelEls: HTMLElement[] = [];
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

    this.scene.background = new THREE.Color(0xbcd6ea);
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
    for (const label of this.model.labels) {
      const el = document.createElement('span');
      el.textContent = label.text;
      el.className = label.kind;
      if (label.color !== undefined) el.style.borderColor = cssHex(label.color);
      this.labelLayer.appendChild(el);
      this.labelEls.push(el);
    }

    this.heading = this.placeTrain();
    this.orbit.target.copy(this.model.root.position).add(new THREE.Vector3(0, 0.035, 0));
    this.camera.position.copy(this.orbit.target).add(new THREE.Vector3(0.5, 0.2, -0.3));
    this.orbit.update();

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
  }

  setView(mode: ViewMode, flow: boolean, labels: boolean): void {
    this.mode = mode;
    this.showFlow = flow;
    this.showLabels = labels;
    this.model.setMode(mode, flow);
  }

  setExplode(e: number): void {
    this.model.setExplode(e);
  }

  /** Keep the engine clear of an overlay covering the bottom of the view. */
  setBottomInset(px: number): void {
    this.inset = px;
    this.resize();
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
    const ground = new THREE.Mesh(new THREE.CircleGeometry(R + 8, 64), new THREE.MeshStandardMaterial({ color: 0x6f9460, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.012;
    const ballast = new THREE.Mesh(new THREE.RingGeometry(R - 0.055, R + 0.055, 180), new THREE.MeshStandardMaterial({ color: 0x8b857b, roughness: 1 }));
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
      p.sprite.material.opacity = 0.75 * (1 - p.age / p.life);
    }
  }

  private updateLabels(): void {
    this.labelLayer.style.display = this.showLabels ? '' : 'none';
    if (!this.showLabels) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const camSide = Math.sign(this.model.root.worldToLocal(this.camera.position.clone()).z);
    const p = new THREE.Vector3();
    this.model.labels.forEach((label, i) => {
      const el = this.labelEls[i];
      const wanted = (label.kind === 'mech') === (this.mode === 'mech') && (label.side === 0 || label.side === camSide);
      if (wanted) label.anchor.getWorldPosition(p).project(this.camera);
      if (!wanted || p.z > 1 || Math.abs(p.x) > 1 || Math.abs(p.y) > 1) {
        el.style.display = 'none';
        return;
      }
      el.style.display = '';
      el.style.transform = `translate(${(((p.x + 1) / 2) * w).toFixed(1)}px, ${(((1 - p.y) / 2) * h).toFixed(1)}px) translate(-50%, -135%)`;
    });
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
