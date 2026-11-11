import { KGF_CM2 } from './steam';

/** All lengths in m, masses in kg, SI throughout. Pressures in this file are gauge unless noted. */
export interface LocoParams {
  name: string;
  ambientT: number;
  engine: {
    bore: number;
    stroke: number;
    pistonRodDia: number;
    /** clearance volume (incl. port passage) as a fraction of swept volume */
    clearanceFraction: number;
    portWidth: number;
    portLength: number;
    steamLap: number;
    exhaustLap: number;
    cdPort: number;
    /** steam pipe + superheater + both valve chests */
    chestVolume: number;
    drainCdA: number;
    /** slide valve leakage, steam chest straight to exhaust */
    valveLeakCdA: number;
    /** piston blow-by between the two cylinder ends */
    pistonLeakCdA: number;
    /** per cylinder block */
    wallHeatCapacity: number;
    hConv: number;
    hCond: number;
    wallLossUA: number;
  };
  gear: {
    conRod: number;
    pistonRod: number;
    returnCrankRadius: number;
    linkTail: number;
    /** die block travel from link pivot at full gear */
    dieMax: number;
    radiusRod: number;
    /** combination lever: valve spindle pin to radius rod pin */
    leverUpper: number;
    /** combination lever: radius rod pin to union link pin */
    leverLower: number;
    unionLink: number;
    /** union link pin on the crosshead drop arm, relative to the crosshead pin */
    dropArmX: number;
    dropArmY: number;
    /** valve spindle height above the cylinder axis */
    valveSpindleY: number;
  };
  boiler: {
    volume: number;
    metalHeatCapacity: number;
    lossUA: number;
    /** liquid fill fraction of the boiler at the bottom / top of the water glass */
    glassBottomFill: number;
    glassTopFill: number;
    safetyOpen: number;
    safetyClose: number;
    safetyCdA: number;
    regulatorCdA: number;
    blowerCdA: number;
    whistleCdA: number;
    blowdownCdA: number;
    /** superheat at the steam chest with a full fire [K] */
    superheatMax: number;
  };
  burner: {
    fuelCapacity: number;
    fuelDensity: number;
    lhv: number;
    /** fuel burn rate at draft gain 1 [kg/s] */
    nominalBurn: number;
    /** fraction of heat release that reaches the water */
    efficiency: number;
    naturalDraftGain: number;
    maxDraftGain: number;
    /** blower / exhaust steam flow giving one unit of draft [kg/s] */
    blowerRef: number;
    exhaustRef: number;
  };
  feed: {
    axlePumpPerRev: number;
    handPumpPerStroke: number;
    tenderCapacity: number;
    oilRunTime: number;
  };
  chassis: {
    wheelDia: number;
    locoMass: number;
    tenderMass: number;
    adhesiveMass: number;
    /** rotating parts reduced to the wheel rim */
    wheelEquivMass: number;
    adhesion: number;
    creepSpeed: number;
    /** mechanism friction reduced to the wheel rim */
    frictionForce: number;
    frictionViscous: number;
    rollingCoeff: number;
  };
  track: {
    radius: number;
    gradePermil: number;
    trainMass: number;
    /** equivalent grade of curve resistance = curveK / radius */
    curveK: number;
  };
}

/**
 * Aster Hobby JNR D51 (gauge 1, alcohol fired).
 * [M] = from the assembly/operation manual, [P] = prototype scaled 1:30, [E] = estimate to be replaced by measurement.
 */
export const d51Params: LocoParams = {
  name: 'Aster D51',
  ambientT: 293.15,
  engine: {
    bore: 0.015, // [M] piston ring PR-15
    stroke: 0.022, // [P] 660 mm
    pistonRodDia: 0.004, // [E]
    clearanceFraction: 0.12, // [E]
    portWidth: 0.0016, // [E]
    portLength: 0.009, // [E]
    steamLap: 0.0012, // [E]
    exhaustLap: 0, // [E]
    cdPort: 0.7, // [E]
    chestVolume: 9e-6, // [E]
    drainCdA: 0.1e-6, // [E]
    valveLeakCdA: 0.06e-6, // [E]
    pistonLeakCdA: 0.04e-6, // [E]
    wallHeatCapacity: 60, // [E] ~0.16 kg bronze
    hConv: 250, // [E]
    hCond: 4000, // [E]
    wallLossUA: 0.08, // [E]
  },
  gear: {
    conRod: 0.105, // [E]
    pistonRod: 0.048, // [E]
    returnCrankRadius: 0.007, // [M] valve setting, step 2
    linkTail: 0.016, // [E]
    dieMax: 0.0055, // [E]
    radiusRod: 0.045, // [E]
    leverUpper: 0.0027, // [E]
    leverLower: 0.022, // [E]
    unionLink: 0.014, // [E]
    dropArmX: 0, // [E]
    dropArmY: -0.0117, // [E]
    valveSpindleY: 0.013, // [E]
  },
  boiler: {
    volume: 380e-6, // [E]
    metalHeatCapacity: 400, // [E] ~1 kg copper
    lossUA: 0.5, // [E]
    glassBottomFill: 0.45, // [E]
    glassTopFill: 0.85, // [E]
    safetyOpen: 4.0 * KGF_CM2, // [M]
    safetyClose: 3.7 * KGF_CM2, // [M] must not fall below 3.5
    safetyCdA: 1.2e-6, // [E]
    regulatorCdA: 2.2e-6, // [E]
    blowerCdA: 0.1e-6, // [E]
    whistleCdA: 0.3e-6, // [E]
    blowdownCdA: 0.5e-6, // [E]
    superheatMax: 40, // [E]
  },
  burner: {
    fuelCapacity: 130e-6, // [M]
    fuelDensity: 790, // methanol-based fuel alcohol
    lhv: 21e6,
    nominalBurn: 9.0e-5, // [E] tuned so 130 mL lasts ~20 min running [M]
    efficiency: 0.4, // [E]
    naturalDraftGain: 0.25, // [E]
    maxDraftGain: 1.2, // [E]
    blowerRef: 0.03e-3, // [E]
    exhaustRef: 0.08e-3, // [E]
  },
  feed: {
    axlePumpPerRev: 0.1e-6, // [E] 4 mm ram x 8 mm stroke
    handPumpPerStroke: 1.5e-6, // [E]
    tenderCapacity: 400e-6, // [E]
    oilRunTime: 3600, // [M] refill oil after 60 min
  },
  chassis: {
    wheelDia: 0.0467, // [P] 1400 mm
    locoMass: 6.0, // [E]
    tenderMass: 2.6, // [E]
    adhesiveMass: 4.5, // [E]
    wheelEquivMass: 0.3, // [E]
    adhesion: 0.25, // [E] steel on brass rail
    creepSpeed: 0.02, // [E]
    frictionForce: 3.0, // [E] must turn over on 1 kgf/cm2 air [M]
    frictionViscous: 1.5, // [E]
    rollingCoeff: 0.012, // [E]
  },
  track: {
    radius: 3, // [M] min 2 m
    gradePermil: 0,
    trainMass: 0,
    curveK: 0.015, // [E]
  },
};
