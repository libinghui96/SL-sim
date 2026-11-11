import type { LocoParams } from './params';
import { P_ATM, T_SAT_MAX, T_SAT_MIN, sat, type SatProps } from './steam';

/** Lumped saturated two-phase boiler: water + steam + metal at one temperature. */
export class Boiler {
  /** water + steam mass [kg] */
  M = 0;
  /** internal energy of water, steam and metal [J] */
  U = 0;
  T = 0;
  P = 0;
  /** steam quality (mass fraction of vapour) */
  x = 0;
  props!: SatProps;
  private readonly b: LocoParams['boiler'];

  constructor(p: LocoParams) {
    this.b = p.boiler;
    this.reset(p.ambientT, 0);
  }

  reset(T: number, liquidFill: number): void {
    const s = sat(T);
    const mLiq = (this.b.volume * liquidFill) / s.vf;
    const mVap = (this.b.volume * (1 - liquidFill)) / s.vg;
    this.M = mLiq + mVap;
    this.U = mLiq * s.uf + mVap * s.ug + this.b.metalHeatCapacity * T;
    this.solve(T);
  }

  private energyAt(T: number): number {
    const s = sat(T);
    const x = Math.min(1, Math.max(0, (this.b.volume / this.M - s.vf) / (s.vg - s.vf)));
    return this.M * (s.uf + x * (s.ug - s.uf)) + this.b.metalHeatCapacity * T;
  }

  private solve(guess: number): void {
    let T = guess;
    for (let i = 0; i < 6; i++) {
      const f = this.energyAt(T) - this.U;
      const d = (this.energyAt(T + 0.02) - this.energyAt(T - 0.02)) / 0.04;
      const step = f / d;
      T = Math.min(T_SAT_MAX, Math.max(T_SAT_MIN, T - step));
      if (Math.abs(step) < 1e-5) break;
    }
    const s = sat(T);
    this.T = T;
    this.P = s.P;
    this.props = s;
    this.x = Math.min(1, Math.max(0, (this.b.volume / this.M - s.vf) / (s.vg - s.vf)));
  }

  get gaugePressure(): number {
    return Math.max(0, this.P - P_ATM);
  }

  get liquidMass(): number {
    return this.M * (1 - this.x);
  }

  /** liquid volume / boiler volume */
  get fill(): number {
    return (this.liquidMass * this.props.vf) / this.b.volume;
  }

  /** water glass reading, 0 = bottom nut, 1 = top nut (unclamped) */
  get glass(): number {
    return (this.fill - this.b.glassBottomFill) / (this.b.glassTopFill - this.b.glassBottomFill);
  }

  /** Apply the heat [J] and masses [kg] exchanged during one step; outflows are limited to what the boiler holds. */
  apply(heat: number, steamOut: number, liquidOut: number, feedIn: number, feedT: number): void {
    const s = this.props;
    const maxLiquid = this.b.volume / s.vf;
    steamOut = Math.min(steamOut, this.M * this.x);
    liquidOut = Math.min(liquidOut, this.liquidMass);
    feedIn = Math.max(0, Math.min(feedIn, maxLiquid * 0.999 - this.M));
    this.M += feedIn - steamOut - liquidOut;
    this.M = Math.max(this.M, 1e-6);
    this.U += heat + feedIn * sat(feedT).hf - steamOut * s.hg - liquidOut * s.hf;
    this.solve(this.T);
  }
}
