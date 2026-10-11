/** The route: real station names on a simulated timetable. */
export interface Station {
  code: string
  name: string
  km: number
}

export const STATIONS: Station[] = [
  { code: 'NDLS', name: 'New Delhi', km: 0 },
  { code: 'GZB', name: 'Ghaziabad', km: 26 },
  { code: 'ALJN', name: 'Aligarh Jn', km: 126 },
  { code: 'TDLA', name: 'Tundla Jn', km: 204 },
  { code: 'ETW', name: 'Etawah', km: 296 },
  { code: 'CNB', name: 'Kanpur Central', km: 440 },
  { code: 'PRYJ', name: 'Prayagraj Jn', km: 634 },
]

export type ZoneKind = 'haze' | 'tunnel' | 'yard'
export interface Zone {
  segment: number // between STATIONS[segment] and STATIONS[segment+1]
  from: number // 0..1 within segment
  to: number
  kind: ZoneKind
  label: string
  pm25: number
  pm10Extra: number
}

export const ZONES: Zone[] = [
  { segment: 0, from: 0.15, to: 0.7, kind: 'yard', label: 'Sahibabad freight yard', pm25: 12, pm10Extra: 20 },
  { segment: 1, from: 0.3, to: 0.85, kind: 'haze', label: 'Crop-burning belt', pm25: 30, pm10Extra: 20 },
  { segment: 3, from: 0.45, to: 0.6, kind: 'tunnel', label: 'Cut-and-cover tunnel', pm25: 25, pm10Extra: 50 },
  { segment: 5, from: 0.2, to: 0.5, kind: 'yard', label: 'Panki industrial stretch', pm25: 15, pm10Extra: 15 },
]

/** Simulated seconds spent running each segment, and dwelling at each station. */
export const SEGMENT_S = 150
export const DWELL_S = 24
export const LEG_S = SEGMENT_S + DWELL_S
export const ROUTE_S = (STATIONS.length - 1) * LEG_S

export interface TrainPos {
  segment: number
  frac: number // 0..1 along the segment
  atStation: boolean
  stationIdx: number // station the train is at (if dwelling) or heading to
  nextStopIn: number // seconds
  zone: Zone | null
  overall: number // 0..1 along the whole route
}

export function trainPosition(routeT: number): TrainPos {
  const t = ((routeT % ROUTE_S) + ROUTE_S) % ROUTE_S
  const leg = Math.floor(t / LEG_S)
  const inLeg = t - leg * LEG_S
  // each leg = run segment `leg`, then dwell at station leg+1
  if (inLeg < SEGMENT_S) {
    const frac = inLeg / SEGMENT_S
    const zone = ZONES.find((z) => z.segment === leg && frac >= z.from && frac <= z.to) ?? null
    return {
      segment: leg, frac, atStation: false, stationIdx: leg + 1,
      nextStopIn: SEGMENT_S - inLeg, zone, overall: (leg + frac) / (STATIONS.length - 1),
    }
  }
  return {
    segment: leg, frac: 1, atStation: true, stationIdx: leg + 1,
    nextStopIn: LEG_S - inLeg, zone: null, overall: (leg + 1) / (STATIONS.length - 1),
  }
}
