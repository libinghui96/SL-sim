import { KGF_CM2, P_ATM } from '../sim/steam';

/** 0 at atmospheric pressure, 1 at 4 kgf/cm2 gauge. */
export function pressureLevel(P: number): number {
  return Math.min(1, Math.max(0, (P - P_ATM) / (4 * KGF_CM2)));
}

/** Hue runs blue (exhaust) to red (boiler pressure). */
export function pressureHue(P: number): number {
  return 220 * (1 - pressureLevel(P));
}

export function pressureCss(P: number, alpha = 1): string {
  return `hsla(${pressureHue(P).toFixed(0)}, 80%, ${(62 - 12 * pressureLevel(P)).toFixed(0)}%, ${alpha})`;
}
