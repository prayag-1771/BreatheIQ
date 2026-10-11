export type ScenarioId = 1 | 2 | 3 | 4 | 5 | 6 | 7

export interface ScenarioProfile {
  temp: number // °C added
  hum: number // % added
  pm25: number // µg/m³ added (cabin)
  pm10Extra: number // extra coarse dust on top of the PM2.5-linked PM10
  gas: number // target latent gas level 0..1 (≥0.6 trips MQ-2)
  co2: number // target latent CO₂ level 0..1 (≥0.6 trips MQ-135)
  occupancy: number // passengers added in the instrumented coach
}

export interface ScenarioDef {
  id: ScenarioId
  name: string
  short: string
  blurb: string
  profile: ScenarioProfile
  rampS: number
  holdS: number
  decayS: number
}

const zero: ScenarioProfile = { temp: 0, hum: 0, pm25: 0, pm10Extra: 0, gas: 0, co2: 0, occupancy: 0 }

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 1, name: 'Normal commute', short: 'Normal',
    blurb: 'Mid-morning run. Doors shut, AC on, the cabin breathes fine.',
    profile: zero, rampS: 1, holdS: 0, decayS: 1,
  },
  {
    id: 2, name: 'Platform rush', short: 'Rush',
    blurb: 'Doors open at a crowded platform. Diesel shunters, dust and 40 extra bodies pour in.',
    profile: { ...zero, temp: 2.5, hum: 6, pm25: 58, pm10Extra: 40, co2: 0.75, occupancy: 38 },
    rampS: 12, holdS: 40, decayS: 20,
  },
  {
    id: 3, name: 'Crowded + hot (heat wave)', short: 'Heat wave',
    blurb: 'June afternoon, 46 °C outside, AC struggling, standing room only.',
    profile: { ...zero, temp: 9, hum: 14, pm25: 22, co2: 0.8, occupancy: 30 },
    rampS: 18, holdS: 45, decayS: 22,
  },
  {
    id: 4, name: 'Smoke / gas event', short: 'Smoke',
    blurb: 'Someone lights up in the vestibule; a pantry burner leaks. MQ-2 trips.',
    profile: { ...zero, temp: 1, pm25: 85, pm10Extra: 15, gas: 0.95, co2: 0.8 },
    rampS: 10, holdS: 35, decayS: 20,
  },
  {
    id: 5, name: 'Stubble-burning haze belt', short: 'Haze belt',
    blurb: 'November, crossing the crop-burning belt. Smoke seeps through every seal.',
    profile: { ...zero, temp: 1.5, hum: 10, pm25: 420, pm10Extra: 140, co2: 0.7 },
    rampS: 18, holdS: 50, decayS: 24,
  },
  {
    id: 6, name: 'Tunnel dust burst', short: 'Tunnel',
    blurb: 'Brake dust and ballast fines pushed in by the piston effect of a tunnel.',
    profile: { ...zero, pm25: 150, pm10Extra: 260 },
    rampS: 6, holdS: 18, decayS: 16,
  },
  {
    id: 7, name: 'Everything at once', short: 'Everything',
    blurb: 'Heat wave, haze belt, smoke and a packed coach — the day the AQI leaves the chart.',
    profile: { temp: 10, hum: 16, pm25: 470, pm10Extra: 220, gas: 0.95, co2: 0.95, occupancy: 34 },
    rampS: 16, holdS: 55, decayS: 24,
  },
]

export const scenarioById = (id: ScenarioId) => SCENARIOS.find((s) => s.id === id)!

/** 0..1 intensity envelope; `sustain` keeps it at full until released. */
export function envelope(def: ScenarioDef, elapsedS: number, sustain: boolean) {
  if (def.id === 1) return 0
  if (elapsedS < def.rampS) return smooth(elapsedS / def.rampS)
  if (sustain) return 1
  const afterHold = elapsedS - def.rampS - def.holdS
  if (afterHold < 0) return 1
  if (afterHold < def.decayS) return 1 - smooth(afterHold / def.decayS)
  return 0
}

export const scenarioDuration = (def: ScenarioDef) => def.rampS + def.holdS + def.decayS

const smooth = (t: number) => t * t * (3 - 2 * t)
