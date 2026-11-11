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

/** One colour per moving part, shared by the 3D mechanism view and the 2D linkage diagram. */
export const PART_COLORS = {
  coupling: 0x8b949e,
  mainRod: 0xf0883e,
  crosshead: 0xe3b341,
  returnCrank: 0x2ea043,
  eccRod: 0x56d364,
  link: 0xbc8cff,
  radiusRod: 0x39c5cf,
  lever: 0xff7bb5,
  union: 0xdb61a2,
  valve: 0xf85149,
} as const;
export type PartName = keyof typeof PART_COLORS;

export const PART_LABELS: Record<PartName, string> = {
  coupling: '连杆（侧杆）',
  mainRod: '主连杆（摇杆）',
  crosshead: '十字头 / 活塞杆',
  returnCrank: '回动曲柄',
  eccRod: '偏心杆',
  link: '月牙板',
  radiusRod: '半径杆',
  lever: '合并杆',
  union: '结合杆',
  valve: '阀杆 / 滑阀',
};

export function cssHex(color: number): string {
  return '#' + color.toString(16).padStart(6, '0');
}

/** Size a canvas backing store to its CSS box and device pixel ratio; returns null while it is hidden. */
export function prepareCanvas(cv: HTMLCanvasElement): { g: CanvasRenderingContext2D; w: number; h: number } | null {
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  if (w === 0 || h === 0) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
  }
  const g = cv.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}
