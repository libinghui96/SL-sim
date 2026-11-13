import type { LocoParams } from './params';

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Side-view pose of one side's motion. Origin = main driving axle, x forward, y up.
 * Crank angle phi grows with forward rotation: crank pin = r (cos phi, -sin phi); phi = 0 is front dead centre.
 */
export interface GearPose {
  crankPin: Vec2;
  eccPin: Vec2;
  crosshead: Vec2;
  dropPin: Vec2;
  linkPivot: Vec2;
  linkTail: Vec2;
  linkAngle: number;
  dieBlock: Vec2;
  /** Radius-rod attachment above the valve spindle, as in Aster drawing 9. */
  leverTop: Vec2;
  /** Valve-spindle attachment. */
  leverMid: Vec2;
  leverBottom: Vec2;
  /** valve displacement from mid position, + = forward */
  valve: number;
  /** piston displacement from mid stroke, + = forward */
  piston: number;
}

export interface EndEvents {
  /** port opening at dead centre [m] (negative = still lapped) */
  lead: number;
  maxOpening: number;
  /** % of the power stroke */
  cutoff: number;
  release: number;
  /** % of the return stroke at which the exhaust closes */
  compression: number;
}

export interface ValveEvents {
  travel: number;
  front: EndEvents;
  back: EndEvents;
}

const TABLE_N = 720;
const TWO_PI = 2 * Math.PI;

/** Walschaerts gear driving an outside-admission slide valve. */
export class ValveGear {
  readonly crankRadius: number;
  readonly eccAdvance: number;
  readonly eccRod: number;
  readonly pivot: Vec2;
  readonly leverX: number;
  private readonly g: LocoParams['gear'];
  private readonly e: LocoParams['engine'];
  private valveZero = 0;
  private table = new Float64Array(TABLE_N + 1);
  private tableReverser = NaN;

  constructor(p: LocoParams) {
    const g = (this.g = p.gear);
    this.e = p.engine;
    this.crankRadius = p.engine.stroke / 2;
    this.leverX = g.conRod + g.dropArmX + g.unionLink;
    this.pivot = { x: this.leverX - g.radiusRod, y: g.valveSpindleY + g.leverUpper };
    // Drawing 9 has a trailing return crank; this setting centres the estimated link at both dead centres.
    const tx = this.pivot.x;
    const ty = this.pivot.y - g.linkTail;
    this.eccAdvance = Math.atan2(tx, ty) - Math.PI;
    this.eccRod = Math.sqrt(tx * tx + ty * ty + g.returnCrankRadius * g.returnCrankRadius);
    // Valve set on its spindle so the travel is centred over the ports, averaged over both gears.
    let zero = 0;
    for (const u of [1, -1]) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < 360; i++) {
        const x = this.solve((i * TWO_PI) / 360, u).leverMid.x;
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
      zero += (lo + hi) / 4;
    }
    this.valveZero = zero;
    this.setReverser(0);
  }

  piston(phi: number): number {
    const r = this.crankRadius;
    const s = r * Math.sin(phi);
    return r * Math.cos(phi) + Math.sqrt(this.g.conRod * this.g.conRod - s * s) - this.g.conRod;
  }

  dPiston(phi: number): number {
    const r = this.crankRadius;
    const s = Math.sin(phi);
    return -r * s - (r * r * s * Math.cos(phi)) / Math.sqrt(this.g.conRod * this.g.conRod - r * r * s * s);
  }

  /** reverser: +1 = full forward gear, -1 = full backward gear. */
  solve(phi: number, reverser: number): GearPose {
    const g = this.g;
    const r = this.crankRadius;
    const crankPin = { x: r * Math.cos(phi), y: -r * Math.sin(phi) };
    const piston = this.piston(phi);
    const crosshead = { x: g.conRod + piston, y: 0 };
    const dropPin = { x: crosshead.x + g.dropArmX, y: g.dropArmY };
    const ea = phi + this.eccAdvance;
    const eccPin = { x: g.returnCrankRadius * Math.cos(ea), y: -g.returnCrankRadius * Math.sin(ea) };

    // expansion link angle: tail pin on a circle about the pivot, at eccentric-rod length from the eccentric pin
    const K = this.pivot;
    const wx = K.x - eccPin.x;
    const wy = K.y - eccPin.y;
    const w2 = wx * wx + wy * wy;
    const q = (this.eccRod * this.eccRod - w2 - g.linkTail * g.linkTail) / (2 * g.linkTail);
    const psi = Math.atan2(wy, wx) + Math.asin(Math.max(-1, Math.min(1, q / Math.sqrt(w2))));
    const c = Math.cos(psi);
    const s = Math.sin(psi);
    const linkTail = { x: K.x + g.linkTail * s, y: K.y - g.linkTail * c };

    // die block on the link slot, an arc of radius-rod radius; forward gear = lower half
    const a = (-reverser * g.dieMax) / g.radiusRod;
    const lx = g.radiusRod * (1 - Math.cos(a));
    const ly = g.radiusRod * Math.sin(a);
    const dieBlock = { x: K.x + lx * c - ly * s, y: K.y + lx * s + ly * c };

    // Drawing 9: radius rod above the spindle, union link below it.
    const la = -g.leverUpper;
    const lb = g.leverLower;
    let xv = this.leverX;
    let beta = 0;
    for (let it = 0; it < 20; it++) {
      const sb = Math.sin(beta);
      const cb = Math.cos(beta);
      const rx = xv + la * sb - dieBlock.x;
      const ry = g.valveSpindleY - la * cb - dieBlock.y;
      const ux = xv + lb * sb - dropPin.x;
      const uy = g.valveSpindleY - lb * cb - dropPin.y;
      const f1 = rx * rx + ry * ry - g.radiusRod * g.radiusRod;
      const f2 = ux * ux + uy * uy - g.unionLink * g.unionLink;
      const j11 = 2 * rx;
      const j12 = 2 * la * (rx * cb + ry * sb);
      const j21 = 2 * ux;
      const j22 = 2 * lb * (ux * cb + uy * sb);
      const det = j11 * j22 - j12 * j21;
      const dx = (f1 * j22 - f2 * j12) / det;
      const db = (j11 * f2 - j21 * f1) / det;
      xv -= dx;
      beta -= db;
      if (Math.abs(dx) < 1e-10 && Math.abs(db) < 1e-9) break;
    }
    const sb = Math.sin(beta);
    const cb = Math.cos(beta);
    return {
      crankPin,
      eccPin,
      crosshead,
      dropPin,
      linkPivot: K,
      linkTail,
      linkAngle: psi,
      dieBlock,
      leverTop: { x: xv + la * sb, y: g.valveSpindleY - la * cb },
      leverMid: { x: xv, y: g.valveSpindleY },
      leverBottom: { x: xv + lb * sb, y: g.valveSpindleY - lb * cb },
      valve: xv - this.valveZero,
      piston,
    };
  }

  setReverser(reverser: number): void {
    if (reverser === this.tableReverser) return;
    this.tableReverser = reverser;
    for (let i = 0; i <= TABLE_N; i++) this.table[i] = this.solve((i * TWO_PI) / TABLE_N, reverser).valve;
  }

  /** Valve displacement at crank angle phi for the reverser position last set. */
  valveAt(phi: number): number {
    let t = (phi / TWO_PI) % 1;
    if (t < 0) t += 1;
    const s = t * TABLE_N;
    const i = Math.floor(s);
    const f = s - i;
    return this.table[i] * (1 - f) + this.table[i + 1] * f;
  }

  /** Valve events for a reverser position, with the wheels turning in the direction of that gear. */
  events(reverser: number): ValveEvents {
    const dir = reverser >= 0 ? 1 : -1;
    const stroke = 2 * this.crankRadius;
    const steps = 1440;
    const xs = new Float64Array(steps + 1);
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k <= steps; k++) {
      xs[k] = this.solve((dir * k * TWO_PI) / steps, reverser).valve;
      lo = Math.min(lo, xs[k]);
      hi = Math.max(hi, xs[k]);
    }
    const end = (front: boolean): EndEvents => {
      const sgn = front ? 1 : -1;
      const k0 = front ? 0 : steps / 2;
      const strokePct = (k: number) => {
        const x = this.piston((dir * (k0 + k) * TWO_PI) / steps);
        const out = front ? (this.crankRadius - x) / stroke : (x + this.crankRadius) / stroke;
        return 100 * out;
      };
      const ev: EndEvents = { lead: sgn * xs[k0] - this.e.steamLap, maxOpening: 0, cutoff: 0, release: 100, compression: 100 };
      let stage = 0;
      let wasOpen = false;
      for (let k = 0; k <= steps; k++) {
        const x = sgn * xs[(k0 + k) % steps];
        const adm = x - this.e.steamLap;
        const exh = -x - this.e.exhaustLap;
        if (stage === 0) {
          ev.maxOpening = Math.max(ev.maxOpening, Math.min(adm, this.e.portWidth));
          if (adm > 0) wasOpen = true;
          else if (wasOpen || k > steps / 4) {
            ev.cutoff = wasOpen ? strokePct(k) : 0;
            stage = 1;
          }
        } else if (stage === 1) {
          if (exh > 0) {
            ev.release = k <= steps / 2 ? strokePct(k) : 100;
            stage = 2;
          }
        } else if (stage === 2 && exh <= 0) {
          ev.compression = k > steps / 2 ? 100 - strokePct(k) : 0;
          break;
        }
      }
      return ev;
    };
    return { travel: hi - lo, front: end(true), back: end(false) };
  }
}
