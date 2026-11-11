import type { LocoParams } from './params';
import { CP_STEAM, CV_STEAM, GAMMA, P_ATM, R_STEAM, orificeFlow, tSat } from './steam';
import type { ValveGear } from './valveGear';

const H_FG = 2.2e6;
const RHO_LIQ = 950;
const T_EXHAUST = 373.15;
const IND_N = 360;
const TWO_PI = 2 * Math.PI;

export interface PortOpenings {
  admFront: number;
  admBack: number;
  exhFront: number;
  exhBack: number;
}

/** Port opening widths [m] of an outside-admission slide valve displaced xv from mid position. */
export function portOpenings(e: LocoParams['engine'], xv: number, out: PortOpenings): PortOpenings {
  const w = e.portWidth;
  out.admBack = Math.min(w, Math.max(0, xv - e.steamLap));
  out.admFront = Math.min(w, Math.max(0, -xv - e.steamLap));
  out.exhFront = Math.min(w, Math.max(0, xv - e.exhaustLap));
  out.exhBack = Math.min(w, Math.max(0, -xv - e.exhaustLap));
  return out;
}

/**
 * Two double-acting cylinders fed from a common steam chest.
 * Control volume index = side * 2 + end; side 0 = left, 1 = right (leads by 90°); end 0 = front, 1 = back.
 */
export class Engine {
  readonly m = new Float64Array(4);
  readonly U = new Float64Array(4);
  readonly P = new Float64Array(4);
  readonly T = new Float64Array(4);
  readonly liquid = new Float64Array(4);
  /** steam mass within m; the rest is air drawn back through the exhaust, which does not condense */
  readonly steam = new Float64Array(4);
  private readonly vol = new Float64Array(4);
  readonly wallT = new Float64Array(2);
  chestM = 0;
  chestSteam = 0;
  chestU = 0;
  chestP = P_ATM;
  chestT = 0;

  /** results of the last step */
  torque = 0;
  steamIn = 0;
  exhaustOut = 0;
  drainOut = 0;
  liquidOut = 0;

  /** indicator diagram of each control volume, one sample per degree of crank angle */
  readonly indP = [0, 1, 2, 3].map(() => new Float32Array(IND_N));
  readonly indV = [0, 1, 2, 3].map(() => new Float32Array(IND_N));

  readonly pistonArea: number;
  readonly rodArea: number;
  readonly clearance: number;
  private readonly wallArea: number;
  private readonly open: PortOpenings = { admFront: 0, admBack: 0, exhFront: 0, exhBack: 0 };
  private readonly e: LocoParams['engine'];

  constructor(
    private readonly p: LocoParams,
    private readonly gear: ValveGear,
  ) {
    const e = (this.e = p.engine);
    this.pistonArea = (Math.PI / 4) * e.bore * e.bore;
    this.rodArea = (Math.PI / 4) * e.pistonRodDia * e.pistonRodDia;
    this.clearance = e.clearanceFraction * this.pistonArea * e.stroke;
    this.wallArea = 2 * this.pistonArea + Math.PI * e.bore * (e.stroke / 2);
    this.reset(p.ambientT, 0);
  }

  volume(end: number, x: number): number {
    const r = this.e.stroke / 2;
    return end === 0 ? this.clearance + this.pistonArea * (r - x) : this.clearance + (this.pistonArea - this.rodArea) * (x + r);
  }

  reset(T: number, phi: number): void {
    for (let side = 0; side < 2; side++) {
      const x = this.gear.piston(phi + (side * Math.PI) / 2);
      this.wallT[side] = T;
      for (let end = 0; end < 2; end++) {
        const i = side * 2 + end;
        const V = this.volume(end, x);
        this.vol[i] = V;
        this.P[i] = P_ATM;
        this.T[i] = T;
        this.m[i] = (P_ATM * V) / (R_STEAM * T);
        this.U[i] = this.m[i] * CV_STEAM * T;
        this.liquid[i] = 0;
        this.steam[i] = 0;
      }
    }
    this.chestP = P_ATM;
    this.chestT = T;
    this.chestM = (P_ATM * this.e.chestVolume) / (R_STEAM * T);
    this.chestSteam = 0;
    this.chestU = this.chestM * CV_STEAM * T;
    for (let i = 0; i < 4; i++) this.indP[i].fill(P_ATM);
  }

  step(dt: number, phi: number, pBoiler: number, tBoiler: number, regulatorCdA: number, superheat: number, drainsOpen: boolean): void {
    const e = this.e;
    const pch = this.chestP;
    const tch = this.chestT;
    const ych = Math.min(1, this.chestSteam / this.chestM);
    let dmChest = 0;
    let dsChest = 0;
    let dhChest = 0;

    // boiler -> chest through the regulator and superheater
    const tIn = tBoiler + superheat;
    let dmReg = 0;
    if (pBoiler > pch) {
      dmReg = Math.min(orificeFlow(regulatorCdA, pBoiler, tBoiler, pch) * dt, ((pBoiler - pch) * e.chestVolume) / (GAMMA * R_STEAM * tIn));
      dmChest += dmReg;
      dsChest += dmReg;
      dhChest += dmReg * CP_STEAM * tIn;
    }
    this.steamIn = dmReg;

    let exhaustOut = 0;
    if (pch > P_ATM) {
      const dm = Math.min(orificeFlow(e.valveLeakCdA, pch, tch, P_ATM) * dt, ((pch - P_ATM) * e.chestVolume) / (GAMMA * R_STEAM * tch));
      dmChest -= dm;
      dsChest -= dm * ych;
      dhChest -= dm * CP_STEAM * tch;
      exhaustOut += dm;
    }

    const chestLimit = 0.2 * this.chestM;
    const portCdA = e.cdPort * e.portLength;
    let torque = 0;
    let drainOut = 0;
    let liquidOut = 0;

    for (let side = 0; side < 2; side++) {
      const ps = phi + (side * Math.PI) / 2;
      const x = this.gear.piston(ps);
      const dx = this.gear.dPiston(ps);
      portOpenings(e, this.gear.valveAt(ps), this.open);
      let wallHeat = 0;
      let force = P_ATM * this.rodArea;
      const tw = this.wallT[side];

      // piston blow-by from the high-pressure end to the other
      const hi = this.P[side * 2] > this.P[side * 2 + 1] ? side * 2 : side * 2 + 1;
      const lo = hi ^ 1;
      const dmLeak = Math.min(
        orificeFlow(e.pistonLeakCdA, this.P[hi], this.T[hi], this.P[lo]) * dt,
        ((this.P[hi] - this.P[lo]) * Math.min(this.vol[hi], this.vol[lo])) / (2 * GAMMA * R_STEAM * this.T[hi]),
      );
      const dsLeak = (dmLeak * this.steam[hi]) / this.m[hi];
      this.m[hi] -= dmLeak;
      this.steam[hi] -= dsLeak;
      this.U[hi] -= dmLeak * CP_STEAM * this.T[hi];
      this.m[lo] += dmLeak;
      this.steam[lo] += dsLeak;
      this.U[lo] += dmLeak * CP_STEAM * this.T[hi];

      for (let end = 0; end < 2; end++) {
        const i = side * 2 + end;
        let m = this.m[i];
        let ms = this.steam[i];
        let U = this.U[i];
        const P = this.P[i];
        const T = this.T[i];
        const V = this.vol[i];
        const y = ms / m;
        const eq = V / (GAMMA * R_STEAM);

        // admission port (flow may reverse during compression)
        const aAdm = portCdA * (end === 0 ? this.open.admFront : this.open.admBack);
        if (aAdm > 0) {
          if (pch > P) {
            const dm = Math.min(orificeFlow(aAdm, pch, tch, P) * dt, ((pch - P) * eq) / tch, chestLimit);
            m += dm;
            ms += dm * ych;
            U += dm * CP_STEAM * tch;
            dmChest -= dm;
            dsChest -= dm * ych;
            dhChest -= dm * CP_STEAM * tch;
          } else if (P > pch) {
            const dm = Math.min(orificeFlow(aAdm, P, T, pch) * dt, ((P - pch) * eq) / T);
            m -= dm;
            ms -= dm * y;
            U -= dm * CP_STEAM * T;
            dmChest += dm;
            dsChest += dm * y;
            dhChest += dm * CP_STEAM * T;
          }
        }

        // exhaust port; draws air back from the blast pipe when the cylinder is below atmospheric (coasting)
        const exhOpen = end === 0 ? this.open.exhFront : this.open.exhBack;
        if (exhOpen > 0) {
          const aExh = portCdA * exhOpen;
          if (P > P_ATM) {
            const dm = Math.min(orificeFlow(aExh, P, T, P_ATM) * dt, ((P - P_ATM) * eq) / T);
            m -= dm;
            ms -= dm * y;
            U -= dm * CP_STEAM * T;
            exhaustOut += dm;
          } else {
            const dm = Math.min(orificeFlow(aExh, P_ATM, T_EXHAUST, P) * dt, ((P_ATM - P) * eq) / T_EXHAUST);
            m += dm;
            U += dm * CP_STEAM * T_EXHAUST;
          }
          const dl = this.liquid[i] * Math.min(1, 80 * dt) * (exhOpen / e.portWidth);
          this.liquid[i] -= dl;
          liquidOut += dl;
        }

        if (drainsOpen && P > P_ATM) {
          const dm = Math.min(orificeFlow(e.drainCdA, P, T, P_ATM) * dt, ((P - P_ATM) * eq) / T);
          m -= dm;
          ms -= dm * y;
          U -= dm * CP_STEAM * T;
          drainOut += dm;
          const dl = this.liquid[i] * Math.min(1, 300 * dt);
          this.liquid[i] -= dl;
          liquidOut += dl;
        }
        ms = Math.min(m, Math.max(0, ms));

        // wall: convection (exact relaxation toward wall temperature) and film condensation on a cold wall
        let Tg = U / (m * CV_STEAM);
        const Tr = tw + (Tg - tw) * Math.exp((-e.hConv * this.wallArea * dt) / (m * CV_STEAM));
        const q = m * CV_STEAM * (Tg - Tr);
        U -= q;
        wallHeat += q;
        Tg = Tr;
        const pSteam = (P * ms) / m;
        if (tw < 440 && pSteam > 3000) {
          const ts = tSat(pSteam);
          if (ts > tw) {
            const dm = Math.min((e.hCond * this.wallArea * (ts - tw) * dt) / H_FG, 0.2 * ms);
            m -= dm;
            ms -= dm;
            U -= dm * CP_STEAM * Tg;
            this.liquid[i] += dm;
            wallHeat += dm * H_FG;
          }
        }

        // piston work; condensate that cannot escape takes up gas volume
        const Vn = Math.max(this.volume(end, x) - this.liquid[i] / RHO_LIQ, 0.3 * this.clearance);
        U -= P * (Vn - V);
        m = Math.max(m, 1e-12);
        const Tn = Math.min(900, Math.max(250, U / (m * CV_STEAM)));
        U = m * CV_STEAM * Tn;
        const Pn = (m * R_STEAM * Tn) / Vn;
        this.m[i] = m;
        this.steam[i] = Math.min(m, ms);
        this.U[i] = U;
        this.T[i] = Tn;
        this.P[i] = Pn;
        this.vol[i] = Vn;
        force += end === 0 ? -Pn * this.pistonArea : Pn * (this.pistonArea - this.rodArea);

        let bin = Math.floor(((ps / TWO_PI) % 1) * IND_N);
        if (bin < 0) bin += IND_N;
        this.indP[i][bin] = Pn;
        this.indV[i][bin] = Vn;
      }

      torque += force * dx;
      this.wallT[side] = tw + (wallHeat - e.wallLossUA * (tw - this.p.ambientT) * dt) / e.wallHeatCapacity;
    }

    this.chestM = Math.max(this.chestM + dmChest, 1e-12);
    this.chestSteam = Math.min(this.chestM, Math.max(0, this.chestSteam + dsChest));
    this.chestU += dhChest;
    this.chestT = Math.min(900, Math.max(250, this.chestU / (this.chestM * CV_STEAM)));
    this.chestU = this.chestM * CV_STEAM * this.chestT;
    this.chestP = (this.chestM * R_STEAM * this.chestT) / e.chestVolume;

    this.torque = torque;
    this.exhaustOut = exhaustOut;
    this.drainOut = drainOut;
    this.liquidOut = liquidOut;
  }
}
