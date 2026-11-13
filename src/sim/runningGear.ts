const TWO_PI = 2 * Math.PI;

/**
 * D51 2-8-2 running gear: four coupled axles, numbered front to rear (zero-based).
 * Coordinates [m]: origin at the third driver, x forward, y up, z across the frames.
 * Drawings 5–7 locate the main rod/return crank and the between-frame pump eccentric
 * on the THIRD axle. Dimensions and the pump's phase offset are model estimates.
 */
export const RUNNING_GEAR = {
  driverX: [0.1034, 0.0517, 0, -0.0517],
  mainAxle: 2,
  pumpAxle: 2,
  pump: {
    eccentricRadius: 0.004,
    rodLength: 0.120,
    /** Fig. 6: rear-frame pump above the axles; dimensions estimated. */
    bodyX: -0.150,
    axisY: 0.026,
    z: 0.009,
    /** Estimated phase relative to the left-side crank, NOT measured from the drawing. */
    phaseOffset: 0,
  },
} as const;

/** Angle in [0, 2π), including negative and multi-turn input; never returns -0. */
export function wrapAngle(phi: number): number {
  const phase = phi % TWO_PI;
  if (phase === 0) return 0;
  // Adding a very small negative remainder to 2π can round to exactly 2π.
  return phase < 0 ? (phase + TWO_PI) % TWO_PI : phase;
}

/**
 * Unwrapped crank angle: side 0 = left, side 1 = right. All FOUR axles on the
 * same side share this phase. Right-leading quartering is the existing MODEL
 * CONVENTION, not a handedness measurement from the drawings.
 */
export function sidePhase(phi: number, side: 0 | 1 | number): number {
  return phi + (side * Math.PI) / 2;
}

export interface PumpPose {
  /** Wrapped eccentric phase [rad]. */
  phase: number;
  eccentric: { x: number; y: number };
  /** Fork pin on the longitudinal ram axis, joined to the eccentric by a fixed-length rod. */
  ram: { x: number; y: number };
  /** Ram velocity [m/s], negative toward the rear-mounted pump cylinder. */
  velocity: number;
  /** 0 = fully forward (compression starts), 1 = fully rearward (compression ends). */
  strokeFraction: number;
  delivering: boolean;
}

const { eccentricRadius: R, rodLength: L, axisY: H } = RUNNING_GEAR.pump;
const PUMP_AXLE_X = RUNNING_GEAR.driverX[RUNNING_GEAR.pumpAxle];
const FRONT_PHASE = Math.asin(H / (L - R));
const REAR_PHASE = Math.PI + Math.asin(H / (L + R));
const FRONT_X = PUMP_AXLE_X - Math.sqrt((L - R) ** 2 - H * H);
const REAR_X = PUMP_AXLE_X - Math.sqrt((L + R) ** 2 - H * H);
const COMPRESSION_ANGLE = REAR_PHASE - FRONT_PHASE;

/** Actual offset-slider stroke [m], not 2r. */
export function pumpStrokeLength(): number {
  return FRONT_X - REAR_X;
}

/** Ram x coordinate [m] on the rearward branch of the exact slider-crank closure. */
function ramX(phase: number): number {
  const q = H + R * Math.sin(phase);
  return PUMP_AXLE_X + R * Math.cos(phase) - Math.sqrt(L * L - q * q);
}

/** Phase measured from the forward dead centre for monotonic integration. */
function ramFromFront(phase: number): number {
  if (phase === 0 || phase === TWO_PI) return FRONT_X;
  if (phase === COMPRESSION_ANGLE) return REAR_X;
  return ramX(phase + FRONT_PHASE);
}

/** Between-frame eccentric, connecting rod and rearward pump ram; omega is signed [rad/s]. */
export function pumpPose(phi: number, omega: number): PumpPose {
  const { eccentricRadius: r, rodLength: l, axisY, phaseOffset } = RUNNING_GEAR.pump;
  const axleX = RUNNING_GEAR.driverX[RUNNING_GEAR.pumpAxle];
  const phase = wrapAngle(phi + phaseOffset);
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  const eccentric = { x: axleX + r * c, y: -r * s };
  const q = axisY - eccentric.y;
  const rodX = Math.sqrt(l * l - q * q);
  const ram = { x: eccentric.x - rodX, y: axisY };
  // Allow only angle-roundoff at the true offset dead centres.
  const tolerance = 4 * Number.EPSILON * Math.max(TWO_PI, Math.abs(phi + phaseOffset));
  const atFront = Math.abs(phase - FRONT_PHASE) <= tolerance;
  const atRear = Math.abs(phase - REAR_PHASE) <= tolerance;
  const velocity = omega === 0 || atFront || atRear ? 0 : omega * (-r * s + r * q * c / rodX);
  const strokeFraction = atFront ? 0 : atRear ? 1 : Math.min(1, Math.max(0, (FRONT_X - ram.x) / pumpStrokeLength()));
  return { phase, eccentric, ram, velocity, strokeFraction, delivering: velocity < 0 };
}

/**
 * Delivered volume [m³] along a signed, unwrapped crank-angle traversal.
 * Check valves deliver only on rearward ram travel, in either rotation direction.
 * Each full turn delivers volumePerRev (the existing estimated pump capacity).
 * Split at the actual dead centres, not half turns. Removing full turns first
 * leaves at most three monotonic residual segments.
 */
export function pumpDisplacement(fromPhi: number, toPhi: number, volumePerRev: number): number {
  const delta = toPhi - fromPhi;
  if (delta === 0 || volumePerRev <= 0) return 0;
  const distance = Math.abs(delta);
  const turns = Math.floor(distance / TWO_PI);
  const direction = delta > 0 ? 1 : -1;
  // Use the same rounded quotient for both terms: % can otherwise leave almost
  // a whole extra turn when distance / TWO_PI rounds to an integer (e.g. 100000 turns).
  let remaining = distance - turns * TWO_PI;
  let phase = wrapAngle(fromPhi + RUNNING_GEAR.pump.phaseOffset - FRONT_PHASE);
  let compression = 0;

  while (remaining > 0) {
    if (direction < 0 && phase === 0) phase = TWO_PI;
    const boundary = direction > 0
      ? (phase < COMPRESSION_ANGLE ? COMPRESSION_ANGLE : TWO_PI)
      : (phase > COMPRESSION_ANGLE ? COMPRESSION_ANGLE : 0);
    const toBoundary = Math.abs(boundary - phase);
    const step = Math.min(remaining, toBoundary);
    const next = step === toBoundary ? boundary : phase + direction * step;
    const rearward = direction > 0 ? phase < COMPRESSION_ANGLE : phase > COMPRESSION_ANGLE;
    if (rearward) compression += Math.max(0, ramFromFront(phase) - ramFromFront(next));
    remaining -= step;
    phase = next === TWO_PI ? 0 : next;
  }

  return (turns + compression / pumpStrokeLength()) * volumePerRev;
}