/**
 * The four Random-Forest heads from final.py, re-expressed as small pure functions.
 * Each head sees one feature (as in the real script): X ← Temperature, Y ← Gas,
 * Z ← CO2, W ← Pms. Confidence = share of the 100 trees that vote "abnormal",
 * which drops near the decision boundary.
 */
import { createRng, clamp } from './rng'

export type HeadKey = 'x' | 'y' | 'z' | 'w'
export type Bit = 0 | 1

export interface ModelInput {
  temp: number
  gas: Bit // MQ-2 digital: 1 = normal, 0 = detected
  co2: Bit // MQ-135 digital: 1 = normal, 0 = detected
  pms: number // PM value forwarded by firmware (PM1.0 standard)
}

export interface Thresholds {
  tempC: number
  pm: number
}
export const DEFAULT_THRESHOLDS: Thresholds = { tempC: 34.5, pm: 80 }

export interface HeadDef {
  key: HeadKey
  letter: 'X' | 'Y' | 'Z' | 'W'
  feature: 'Temperature' | 'Gas' | 'CO2' | 'Pms'
  label: string
  sensor: string
  actuator: string
  normal: string
  abnormal: string
  lcd: [string, string]
}

export const HEADS: HeadDef[] = [
  {
    key: 'x', letter: 'X', feature: 'Temperature', label: 'label_Temperature', sensor: 'DHT11',
    actuator: 'Exhaust fan', normal: 'Temperature is normal', abnormal: 'Temperature is abnormal',
    lcd: ['Abnormal Temp', 'Detected'],
  },
  {
    key: 'y', letter: 'Y', feature: 'Gas', label: 'label_Gas', sensor: 'MQ-2',
    actuator: 'Ozone generator 2', normal: 'Gases is normal', abnormal: 'Gases detected',
    lcd: ['Abnormal Gases', 'Detected'],
  },
  {
    key: 'z', letter: 'Z', feature: 'CO2', label: 'label_CO2', sensor: 'MQ-135',
    actuator: 'Ozone generator 1', normal: 'Air quality is normal', abnormal: 'Air quality is abnormal',
    lcd: ['CO2 Gas', 'Detected'],
  },
  {
    key: 'w', letter: 'W', feature: 'Pms', label: 'label_Pms', sensor: 'PMS7003',
    actuator: 'Ozone generators 1 + 2', normal: 'No dust particles detected', abnormal: 'Dust particles detected',
    lcd: ['Dust Particles', 'Detected'],
  },
]

export type Prediction = Record<HeadKey, { value: Bit; conf: number; pAbnormal: number }>

const sigmoid = (v: number) => 1 / (1 + Math.exp(-v))

/** Probability the head votes "abnormal". `wobble` ∈ [-1,1] adds forest-like jitter. */
export function headProbability(key: HeadKey, input: ModelInput, th: Thresholds, wobble = 0) {
  let p: number
  switch (key) {
    case 'x':
      p = sigmoid((input.temp - th.tempC) / 0.45)
      break
    case 'y':
      p = input.gas === 0 ? 0.97 : 0.02
      break
    case 'z':
      p = input.co2 === 0 ? 0.96 : 0.03
      break
    case 'w':
      p = sigmoid((input.pms - th.pm) / 7)
      break
  }
  p = clamp(p + wobble * 0.025, 0, 1)
  return Math.round(p * 100) / 100 // 100 trees → votes in 1 % steps
}

export function predict(input: ModelInput, th: Thresholds, wobble?: Partial<Record<HeadKey, number>>): Prediction {
  const out = {} as Prediction
  for (const h of HEADS) {
    const pA = headProbability(h.key, input, th, wobble?.[h.key] ?? 0)
    const value: Bit = pA >= 0.5 ? 1 : 0
    out[h.key] = { value, pAbnormal: pA, conf: value ? pA : 1 - pA }
  }
  return out
}

/** LCD priority chain: Temperature → Gas → CO₂ → Dust → all normal. */
export function lcdResult(p: Prediction): [string, string] {
  for (const h of HEADS) if (p[h.key].value === 1) return h.lcd
  return ['All are normal', '']
}

export function replyFrame(p: Prediction) {
  return `t${p.x.value}u${p.y.value}v${p.z.value}x${p.w.value}y`
}

// ── Synthetic training data (same schema as TK172529.xlsx) ─────────────

export type Regime = 'A' | 'B' | 'C'
export const REGIMES: Record<Regime, string> = {
  A: 'Calm cabin',
  B: 'Hot + gases',
  C: 'Hot + gases + heavy dust',
}

export interface Row {
  id: number
  regime: Regime
  Temperature: number
  label_Temperature: Bit
  Gas: Bit
  label_Gas: Bit
  CO2: Bit
  label_CO2: Bit
  Pms: number
  label_Pms: Bit
}

export function generateDataset(seed: number, n = 200): Row[] {
  const rng = createRng(seed)
  const rows: Row[] = []
  const flip = (b: Bit): Bit => (rng.chance(0.02) ? ((1 - b) as Bit) : b)
  for (let i = 0; i < n; i++) {
    const r = rng.next()
    const regime: Regime = r < 0.46 ? 'A' : r < 0.76 ? 'B' : 'C'
    const hot = regime !== 'A'
    const Temperature = Math.round((hot ? rng.range(34, 40) : rng.range(25, 33)) * 100) / 100
    const Gas: Bit = hot ? 0 : 1
    const CO2: Bit = hot ? 0 : 1
    const Pms = regime === 'C' ? rng.int(100, 199) : rng.int(15, 60)
    rows.push({
      id: i + 1,
      regime,
      Temperature,
      label_Temperature: flip(Temperature >= 34.5 ? 1 : 0),
      Gas,
      label_Gas: flip(Gas === 0 ? 1 : 0),
      CO2,
      label_CO2: flip(CO2 === 0 ? 1 : 0),
      Pms,
      label_Pms: flip(Pms >= 100 ? 1 : 0),
    })
  }
  return rows
}

export function splitDataset(rows: Row[], seed: number, testSize = 0.2) {
  const rng = createRng(seed ^ 0x9e3779b9)
  const idx = rows.map((_, i) => i)
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1))
    ;[idx[i], idx[j]] = [idx[j], idx[i]]
  }
  const nTest = Math.round(rows.length * testSize)
  return { test: idx.slice(0, nTest).map((i) => rows[i]), train: idx.slice(nTest).map((i) => rows[i]) }
}

export interface HeadMetrics {
  key: HeadKey
  tp: number
  fp: number
  tn: number
  fn: number
  accuracy: number
  precision: number
  recall: number
  f1: number
}

const rowInput = (r: Row): ModelInput => ({ temp: r.Temperature, gas: r.Gas, co2: r.CO2, pms: r.Pms })
const labelOf = (r: Row, k: HeadKey): Bit =>
  k === 'x' ? r.label_Temperature : k === 'y' ? r.label_Gas : k === 'z' ? r.label_CO2 : r.label_Pms

/** Metrics on the held-out split, computed by actually running the heads. */
export function evaluate(test: Row[], th: Thresholds): HeadMetrics[] {
  return HEADS.map(({ key }) => {
    let tp = 0, fp = 0, tn = 0, fn = 0
    for (const r of test) {
      const yhat = predict(rowInput(r), th)[key].value
      const y = labelOf(r, key)
      if (yhat && y) tp++
      else if (yhat && !y) fp++
      else if (!yhat && !y) tn++
      else fn++
    }
    const precision = tp + fp ? tp / (tp + fp) : 1
    const recall = tp + fn ? tp / (tp + fn) : 1
    return {
      key, tp, fp, tn, fn,
      accuracy: (tp + tn) / Math.max(1, test.length),
      precision,
      recall,
      f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
    }
  })
}

/** |Pearson r| between each feature and each label — what a joint model would lean on. */
export function featureRelevance(rows: Row[]) {
  const feats = ['Temperature', 'Gas', 'CO2', 'Pms'] as const
  const col = (f: (typeof feats)[number]) => rows.map((r) => r[f] as number)
  const corr = (a: number[], b: number[]) => {
    const n = a.length
    const ma = a.reduce((s, v) => s + v, 0) / n
    const mb = b.reduce((s, v) => s + v, 0) / n
    let num = 0, da = 0, db = 0
    for (let i = 0; i < n; i++) {
      num += (a[i] - ma) * (b[i] - mb)
      da += (a[i] - ma) ** 2
      db += (b[i] - mb) ** 2
    }
    return da && db ? Math.abs(num / Math.sqrt(da * db)) : 0
  }
  return HEADS.map((h) => {
    const y = rows.map((r) => labelOf(r, h.key))
    const vals = feats.map((f) => corr(col(f), y))
    const total = vals.reduce((s, v) => s + v, 0) || 1
    return { head: h.key, values: feats.map((f, i) => ({ feature: f, share: vals[i] / total })) }
  })
}

export function toCsv(rows: Row[]) {
  const head = 'Temperature,label_Temperature,Gas,label_Gas,CO2,label_CO2,Pms,label_Pms'
  return [head, ...rows.map((r) =>
    [r.Temperature, r.label_Temperature, r.Gas, r.label_Gas, r.CO2, r.label_CO2, r.Pms, r.label_Pms].join(','),
  )].join('\n')
}
