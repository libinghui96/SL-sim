export const R_STEAM = 461.526;
export const GAMMA = 1.3;
export const CP_STEAM = (GAMMA * R_STEAM) / (GAMMA - 1);
export const CV_STEAM = CP_STEAM - R_STEAM;
export const P_ATM = 101325;
export const KGF_CM2 = 98066.5;
export const T_ZERO_C = 273.15;

// IAPWS-IF97 region 4 (saturation line) coefficients
const N = [
  0, 0.11670521452767e4, -0.72421316703206e6, -0.17073846940092e2, 0.1202082470247e5,
  -0.32325550322333e7, 0.1491510861353e2, -0.48232657361591e4, 0.40511340542057e6,
  -0.23855557567849, 0.65017534844798e3,
];

/** Saturation pressure [Pa] at temperature T [K]. */
export function pSat(T: number): number {
  const th = T + N[9] / (T - N[10]);
  const A = th * th + N[1] * th + N[2];
  const B = N[3] * th * th + N[4] * th + N[5];
  const C = N[6] * th * th + N[7] * th + N[8];
  const r = (2 * C) / (-B + Math.sqrt(B * B - 4 * A * C));
  return 1e6 * r * r * r * r;
}

/** Saturation temperature [K] at pressure P [Pa]. */
export function tSat(P: number): number {
  const b = Math.sqrt(Math.sqrt(P / 1e6));
  const E = b * b + N[3] * b + N[6];
  const F = N[1] * b * b + N[4] * b + N[7];
  const G = N[2] * b * b + N[5] * b + N[8];
  const D = (2 * G) / (-F - Math.sqrt(F * F - 4 * E * G));
  const s = N[10] + D;
  return (s - Math.sqrt(s * s - 4 * (N[9] + N[10] * D))) / 2;
}

// Saturated steam table, 0..200 °C in 20 K steps: vf, vg [m3/kg], hf, hg [kJ/kg]
const T_STEP = 20;
const TABLE = [
  [0.001, 206.14, 0.01, 2501.4],
  [0.001002, 57.79, 83.96, 2538.1],
  [0.001008, 19.52, 167.57, 2574.3],
  [0.001017, 7.671, 251.13, 2609.6],
  [0.001029, 3.407, 334.91, 2643.7],
  [0.001044, 1.6729, 419.04, 2676.1],
  [0.00106, 0.8919, 503.71, 2706.3],
  [0.00108, 0.5089, 589.13, 2733.9],
  [0.001102, 0.3071, 675.55, 2758.1],
  [0.001127, 0.19405, 763.22, 2778.2],
  [0.001157, 0.12736, 852.45, 2793.2],
];
export const T_SAT_MIN = T_ZERO_C;
export const T_SAT_MAX = T_ZERO_C + T_STEP * (TABLE.length - 1);

const VF = TABLE.map((r) => r[0]);
const HF = TABLE.map((r) => r[2] * 1e3);
const HG = TABLE.map((r) => r[3] * 1e3);
// vg is interpolated through the compressibility factor, which is far smoother than vg itself
const ZG = TABLE.map((r, i) => {
  const T = T_ZERO_C + i * T_STEP;
  return (pSat(T) * r[1]) / (R_STEAM * T);
});

function catmullRom(y: number[], i: number, t: number): number {
  const n = y.length - 1;
  const p1 = y[i];
  const p2 = y[i + 1];
  const p0 = i > 0 ? y[i - 1] : 2 * p1 - p2;
  const p3 = i + 2 <= n ? y[i + 2] : 2 * p2 - p1;
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
}

export interface SatProps {
  T: number;
  P: number;
  vf: number;
  vg: number;
  hf: number;
  hg: number;
  uf: number;
  ug: number;
}

/** Saturated liquid/vapour properties at T [K] (clamped to 0..200 °C). SI units, J/kg. */
export function sat(T: number): SatProps {
  const Tc = Math.min(Math.max(T, T_SAT_MIN), T_SAT_MAX);
  const s = (Tc - T_ZERO_C) / T_STEP;
  const i = Math.min(Math.floor(s), TABLE.length - 2);
  const t = s - i;
  const P = pSat(Tc);
  const vf = catmullRom(VF, i, t);
  const vg = (catmullRom(ZG, i, t) * R_STEAM * Tc) / P;
  const hf = catmullRom(HF, i, t);
  const hg = catmullRom(HG, i, t);
  return { T: Tc, P, vf, vg, hf, hg, uf: hf - P * vf, ug: hg - P * vg };
}

const PR_CRIT = Math.pow(2 / (GAMMA + 1), GAMMA / (GAMMA - 1));
const PSI_CHOKED = Math.sqrt(GAMMA) * Math.pow(2 / (GAMMA + 1), (GAMMA + 1) / (2 * (GAMMA - 1)));
const PR_LIN = 0.98;

/** Mass flow [kg/s] of steam (ideal gas, isentropic nozzle) through effective area cdA [m2]. Zero if pUp <= pDown. */
export function orificeFlow(cdA: number, pUp: number, tUp: number, pDown: number): number {
  if (cdA <= 0 || pUp <= pDown) return 0;
  const pr = pDown / pUp;
  let psi: number;
  if (pr <= PR_CRIT) {
    psi = PSI_CHOKED;
  } else {
    const q = Math.min(pr, PR_LIN);
    psi = Math.sqrt(((2 * GAMMA) / (GAMMA - 1)) * (Math.pow(q, 2 / GAMMA) - Math.pow(q, (GAMMA + 1) / GAMMA)));
    // linear near pr=1 to avoid the infinite slope of the nozzle equation
    if (pr > PR_LIN) psi *= (1 - pr) / (1 - PR_LIN);
  }
  return (cdA * pUp * psi) / Math.sqrt(R_STEAM * tUp);
}
