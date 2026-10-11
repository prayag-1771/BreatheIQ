/** Indian CPCB National AQI — PM2.5 and PM10 sub-indices, AQI = max. Not clamped at 500. */

export type AqiBand = 'good' | 'satisfactory' | 'moderate' | 'poor' | 'verypoor' | 'severe' | 'offchart'

export const BANDS: { key: AqiBand; label: string; lo: number; hi: number; color: string }[] = [
  { key: 'good', label: 'Good', lo: 0, hi: 50, color: 'var(--aqi-good)' },
  { key: 'satisfactory', label: 'Satisfactory', lo: 51, hi: 100, color: 'var(--aqi-satisfactory)' },
  { key: 'moderate', label: 'Moderate', lo: 101, hi: 200, color: 'var(--aqi-moderate)' },
  { key: 'poor', label: 'Poor', lo: 201, hi: 300, color: 'var(--aqi-poor)' },
  { key: 'verypoor', label: 'Very Poor', lo: 301, hi: 400, color: 'var(--aqi-verypoor)' },
  { key: 'severe', label: 'Severe', lo: 401, hi: 500, color: 'var(--aqi-severe)' },
]
export const OFF_CHART = { key: 'offchart' as const, label: 'Off the chart', color: 'var(--aqi-severe)' }

// [concLo, concHi, aqiLo, aqiHi]
const PM25: [number, number, number, number][] = [
  [0, 30, 0, 50],
  [30, 60, 50, 100],
  [60, 90, 100, 200],
  [90, 120, 200, 300],
  [120, 250, 300, 400],
  [250, 380, 400, 500],
]
const PM10: [number, number, number, number][] = [
  [0, 50, 0, 50],
  [50, 100, 50, 100],
  [100, 250, 100, 200],
  [250, 350, 200, 300],
  [350, 430, 300, 400],
  [430, 510, 400, 500],
]

function subIndex(c: number, table: [number, number, number, number][]) {
  const conc = Math.max(0, c)
  for (const [cl, ch, il, ih] of table) {
    if (conc <= ch) return il + ((conc - cl) * (ih - il)) / (ch - cl)
  }
  // extrapolate past the top band with the severe-band slope
  const [cl, ch, il, ih] = table[table.length - 1]
  return il + ((conc - cl) * (ih - il)) / (ch - cl)
}

export const subIndexPm25 = (c: number) => subIndex(c, PM25)
export const subIndexPm10 = (c: number) => subIndex(c, PM10)

export function computeAqi(pm25: number, pm10: number) {
  const a = subIndexPm25(pm25)
  const b = subIndexPm10(pm10)
  return { aqi: Math.round(Math.max(a, b)), dominant: a >= b ? ('PM2.5' as const) : ('PM10' as const) }
}

export function bandOf(aqi: number): AqiBand {
  if (aqi > 500) return 'offchart'
  for (const b of BANDS) if (aqi <= b.hi) return b.key
  return 'severe'
}

export function bandInfo(aqi: number) {
  const k = bandOf(aqi)
  if (k === 'offchart') return OFF_CHART
  return BANDS.find((b) => b.key === k)!
}

export const bandColor = (aqi: number) => bandInfo(aqi).color

/** Guideline numbers used on the Exposure page (24-h means, µg/m³). */
export const LIMITS = {
  whoPm25: 15,
  whoPm10: 45,
  naaqsPm25: 60,
  naaqsPm10: 100,
  ozonePpm8h: 0.07,
}
