import { Boiler } from './boiler';
import { Engine } from './engine';
import type { LocoParams } from './params';
import { pumpDisplacement } from './runningGear';
import { KGF_CM2, P_ATM, orificeFlow, tSat } from './steam';
import { ValveGear } from './valveGear';

export interface Controls {
  /** 加減弁 0..1 */
  regulator: number;
  /** 逆転機 -1 (full backward) .. +1 (full forward) */
  reverser: number;
  /** 通風弁 0..1 */
  blower: number;
  /** 燃料弁 0..1 */
  fuelValve: number;
  /** バイパス弁 0 = closed (axle pump feeds the boiler) .. 1 = open (water returns to the tender) */
  bypass: number;
  drains: boolean;
  whistle: boolean;
  /** electric suction fan standing in the chimney */
  fan: boolean;
  blowdown: boolean;
}

export type Mode = 'track' | 'rollers';
export type Warning = 'lowWater' | 'dryBoiler' | 'highWater' | 'safety' | 'noFuel' | 'noOil' | 'slip' | 'tenderEmpty';

const G = 9.80665;
const DT_ENGINE = 50e-6;
const DT_IDLE = 1e-3;
const V_STICK = 5e-4;
const RHO_WATER = 998;

/** F tanh(|v|/v0) / |v|: secant stiffness of regularised Coulomb friction, for implicit integration. */
function secant(F: number, v: number, v0: number): number {
  const a = Math.abs(v);
  return a < 1e-9 ? F / v0 : (F * Math.tanh(a / v0)) / a;
}

export class LocoSim {
  readonly gear: ValveGear;
  readonly engine: Engine;
  readonly boiler: Boiler;
  readonly controls: Controls = { regulator: 0, reverser: 1, blower: 0, fuelValve: 0, bypass: 1, drains: false, whistle: false, fan: false, blowdown: false };
  mode: Mode = 'track';

  time = 0;
  /** crank angle of the left side [rad], grows with forward rotation */
  phi = 0.6;
  omega = 0;
  /** vehicle speed [m/s] */
  v = 0;
  distance = 0;
  lit = false;
  /** [m3] */
  fuel = 0;
  tenderWater = 0;
  /** lubricator fill 0..1 */
  oil = 0;
  safetyOpen = false;

  /** fire intensity relative to nominal */
  fireGain = 0;
  superheat = 0;
  /** smoothed flows [kg/s] and forces for display */
  exhaustFlow = 0;
  steamFlow = 0;
  blowerFlow = 0;
  safetyFlow = 0;
  drainFlow = 0;
  feedFlow = 0;
  /** axle pump delivery before the bypass split [kg/s] */
  pumpFlow = 0;
  tractiveForce = 0;
  indicatedPower = 0;
  slip = 0;
  /** heat balance [W]: released by the burner, absorbed by the water, lost from the boiler surface */
  firePower = 0;
  heatToWater = 0;
  boilerLoss = 0;

  steamUsed = 0;
  waterFed = 0;
  fuelBurned = 0;

  private acc = 0;
  private boilerClock = 0;
  private steamAcc = 0;
  private exhaustAcc = 0;
  private drainAcc = 0;
  /** Delivered axle-pump volume [m3] awaiting the next boiler step. */
  private pumpVolumeAcc = 0;
  private handPending = 0;

  constructor(readonly params: LocoParams) {
    this.gear = new ValveGear(params);
    this.engine = new Engine(params, this.gear);
    this.boiler = new Boiler(params);
    this.resetCold();
  }

  /** Cold engine, serviced as in the manual: water glass at 50 %, tender 80 %, fuel and oil filled, fire out. */
  resetCold(): void {
    const p = this.params;
    this.boiler.reset(p.ambientT, (p.boiler.glassBottomFill + p.boiler.glassTopFill) / 2);
    this.engine.reset(p.ambientT, this.phi);
    Object.assign(this.controls, { regulator: 0, reverser: 1, blower: 0, fuelValve: 0, bypass: 1, drains: false, whistle: false, fan: false, blowdown: false });
    this.omega = this.v = 0;
    this.lit = false;
    this.safetyOpen = false;
    this.fuel = p.burner.fuelCapacity;
    this.tenderWater = 0.8 * p.feed.tenderCapacity;
    this.oil = 0.8;
    this.time = this.distance = this.steamUsed = this.waterFed = this.fuelBurned = 0;
    this.fireGain = this.superheat = this.firePower = this.heatToWater = this.boilerLoss = 0;
    this.exhaustFlow = this.steamFlow = this.blowerFlow = this.safetyFlow = this.drainFlow = this.feedFlow = this.pumpFlow = 0;
    this.tractiveForce = this.indicatedPower = this.slip = 0;
    this.acc = this.boilerClock = this.steamAcc = this.exhaustAcc = this.drainAcc = this.pumpVolumeAcc = this.handPending = 0;
  }

  /** In steam at 3.5 kgf/cm2 with warm cylinders, ready to pull away. */
  resetHot(): void {
    this.resetCold();
    const b = this.params.boiler;
    this.boiler.reset(tSat(P_ATM + 3.5 * KGF_CM2), (b.glassBottomFill + b.glassTopFill) / 2);
    this.engine.reset(385, this.phi);
    this.lit = true;
    this.controls.fuelValve = 0.5;
    this.controls.blower = 0.3;
  }

  ignite(): 'ok' | 'noFuel' | 'valveClosed' {
    if (this.fuel <= 0) return 'noFuel';
    if (this.controls.fuelValve <= 0) return 'valveClosed';
    this.lit = true;
    return 'ok';
  }

  extinguish(): void {
    this.lit = false;
  }

  handPump(): void {
    this.handPending += this.params.feed.handPumpPerStroke;
  }

  fillFuel(): void {
    this.fuel = this.params.burner.fuelCapacity;
  }

  fillTender(): void {
    this.tenderWater = this.params.feed.tenderCapacity;
  }

  fillOil(): void {
    this.oil = 0.8;
  }

  /** Push the engine by hand [m/s]. */
  push(dv: number): void {
    if (this.mode === 'track') this.v += dv;
    this.omega += dv / (this.params.chassis.wheelDia / 2);
  }

  get speedScaleKmh(): number {
    return this.v * 3.6 * 30;
  }

  warnings(): Warning[] {
    const w: Warning[] = [];
    const glass = this.boiler.glass;
    if (this.boiler.fill < 0.05) w.push('dryBoiler');
    else if (glass < 0.15) w.push('lowWater');
    if (glass > 1) w.push('highWater');
    if (this.safetyOpen) w.push('safety');
    if (this.fuel <= 0) w.push('noFuel');
    if (this.oil <= 0) w.push('noOil');
    if (Math.abs(this.slip) > 0.05) w.push('slip');
    if (this.tenderWater <= 0) w.push('tenderEmpty');
    return w;
  }

  /** Advance the simulation by dt seconds. */
  advance(dt: number): void {
    this.acc += dt;
    this.gear.setReverser(this.controls.reverser);
    const e = this.engine;
    while (this.acc > 0) {
      const busy = Math.abs(this.omega) > 0.02 || Math.abs(this.v) > V_STICK || this.controls.regulator > 0 || e.chestP > P_ATM + 2000;
      const h = busy ? DT_ENGINE : DT_IDLE;
      this.engineStep(h);
      this.boilerClock += h;
      if (this.boilerClock >= DT_IDLE - 1e-9) {
        this.boilerStep(this.boilerClock);
        this.boilerClock = 0;
      }
      this.acc -= h;
      this.time += h;
    }
  }

  private engineStep(dt: number): void {
    const p = this.params;
    const c = this.controls;
    const e = this.engine;
    const regCdA = p.boiler.regulatorCdA * c.regulator * c.regulator;
    e.step(dt, this.phi, this.boiler.P, this.boiler.T, regCdA, this.superheat, c.drains);
    this.steamAcc += e.steamIn;
    this.exhaustAcc += e.exhaustOut;
    this.drainAcc += e.drainOut;

    const ch = p.chassis;
    const rw = ch.wheelDia / 2;
    const fEng = e.torque / rw;
    const vr = this.omega * rw;
    const mw = ch.wheelEquivMass;
    const dry = this.oil > 0 ? 1 : 2.5;
    const kfw = dry * (secant(ch.frictionForce, vr, V_STICK) + ch.frictionViscous);
    let vrNew: number;
    let vNew: number;
    const atRest = Math.abs(vr) < V_STICK && Math.abs(this.v) < V_STICK;
    if (this.mode === 'track') {
      const M = ch.locoMass + ch.tenderMass + p.track.trainMass;
      const slip = vr - this.v;
      const mu = ch.adhesion * (1 - 0.3 * Math.tanh(Math.abs(slip) / 0.5));
      const ka = secant(mu * ch.adhesiveMass * G, slip, ch.creepSpeed);
      const fRoll = (ch.rollingCoeff + p.track.curveK / p.track.radius) * M * G;
      const kr = secant(fRoll, this.v, V_STICK);
      const fGrade = (M * G * p.track.gradePermil) / 1000;
      if (atRest && Math.abs(fEng - fGrade) < dry * ch.frictionForce + fRoll) {
        // held by static friction
        vrNew = vNew = 0;
      } else {
        const a11 = mw / dt + kfw + ka;
        const a22 = M / dt + kr + ka;
        const b1 = (mw / dt) * vr + fEng;
        const b2 = (M / dt) * this.v - fGrade;
        const det = a11 * a22 - ka * ka;
        vrNew = (b1 * a22 + ka * b2) / det;
        vNew = (a11 * b2 + ka * b1) / det;
      }
      this.slip = vrNew - vNew;
      this.tractiveForce += (ka * this.slip - this.tractiveForce) * Math.min(1, dt / 0.1);
    } else {
      vrNew = atRest && Math.abs(fEng) < dry * ch.frictionForce ? 0 : ((mw / dt) * vr + fEng) / (mw / dt + kfw + 0.5);
      vNew = 0;
      this.slip = 0;
      this.tractiveForce = 0;
    }
    this.omega = vrNew / rw;
    this.v = vNew;
    const fromPhi = this.phi;
    this.phi += this.omega * dt;
    this.distance += this.v * dt;
    this.pumpVolumeAcc += pumpDisplacement(fromPhi, this.phi, p.feed.axlePumpPerRev);
    this.indicatedPower += (e.torque * this.omega - this.indicatedPower) * Math.min(1, dt / 0.3);
  }

  private boilerStep(dt: number): void {
    const p = this.params;
    const b = p.boiler;
    const c = this.controls;
    const P = this.boiler.P;
    const T = this.boiler.T;
    const gauge = P - P_ATM;

    const mBlower = orificeFlow(b.blowerCdA * c.blower, P, T, P_ATM) * dt;
    const mWhistle = c.whistle ? orificeFlow(b.whistleCdA, P, T, P_ATM) * dt : 0;
    if (!this.safetyOpen && gauge >= b.safetyOpen) this.safetyOpen = true;
    else if (this.safetyOpen && gauge <= b.safetyClose) this.safetyOpen = false;
    const mSafety = this.safetyOpen ? orificeFlow(b.safetyCdA, P, T, P_ATM) * dt : 0;
    const mBlowdown = c.blowdown && gauge > 0 ? b.blowdownCdA * Math.sqrt((2 * gauge) / this.boiler.props.vf) * dt : 0;

    // feed water: axle pump (less what the bypass returns to the tender) and hand pump
    const pumpVol = this.tenderWater > 0 ? this.pumpVolumeAcc : 0;
    const feedVol = Math.min(this.tenderWater, pumpVol * (1 - c.bypass) + this.handPending);
    this.pumpVolumeAcc = 0;
    this.handPending = 0;
    this.tenderWater -= feedVol;
    const mFeed = feedVol * RHO_WATER;

    // alcohol burner: burn rate follows the draft through the flues
    const k = Math.min(1, dt / 0.5);
    this.exhaustFlow += (this.exhaustAcc / dt - this.exhaustFlow) * k;
    const bu = p.burner;
    let burn = 0;
    this.fireGain = 0;
    if (this.lit) {
      const supply = Math.min(1, c.fuelValve / 0.3);
      if (this.fuel <= 0 || supply <= 0) {
        this.lit = false;
      } else {
        const draft = (c.fan ? 1 : 0) + mBlower / dt / bu.blowerRef + this.exhaustFlow / bu.exhaustRef;
        this.fireGain = supply * (bu.naturalDraftGain + (bu.maxDraftGain - bu.naturalDraftGain) * (1 - Math.exp(-draft)));
        burn = Math.min(bu.nominalBurn * this.fireGain * dt, this.fuel * bu.fuelDensity);
        this.fuel -= burn / bu.fuelDensity;
        this.fuelBurned += burn;
      }
    }
    this.superheat = b.superheatMax * Math.min(1, this.fireGain);
    // heating surface is only effective where it is wetted
    const wetted = Math.min(1, this.boiler.fill / 0.35);
    this.firePower = (burn * bu.lhv) / dt;
    this.heatToWater = this.firePower * bu.efficiency * wetted;
    this.boilerLoss = b.lossUA * (T - p.ambientT);
    const heat = (this.heatToWater - this.boilerLoss) * dt;

    this.boiler.apply(heat, this.steamAcc + mBlower + mWhistle + mSafety, mBlowdown, mFeed, p.ambientT);

    if (this.steamAcc > 0) this.oil = Math.max(0, this.oil - (0.8 * dt) / p.feed.oilRunTime);
    this.steamUsed += this.steamAcc + mBlower + mWhistle + mSafety;
    this.waterFed += mFeed;
    this.steamFlow += (this.steamAcc / dt - this.steamFlow) * k;
    this.drainFlow += (this.drainAcc / dt - this.drainFlow) * k;
    this.blowerFlow = mBlower / dt;
    this.safetyFlow = mSafety / dt;
    this.feedFlow += (mFeed / dt - this.feedFlow) * k;
    this.pumpFlow += ((pumpVol * RHO_WATER) / dt - this.pumpFlow) * k;
    this.steamAcc = this.exhaustAcc = this.drainAcc = 0;
  }
}
