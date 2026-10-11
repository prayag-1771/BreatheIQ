/**
 * Geography of the route: station coordinates, the train's position between them and
 * the route zones as polygons. Shared by the Fleet map and by the cloud pipeline, which
 * stores the zones as Amazon Location geofences.
 */
import { STATIONS, ZONES, type TrainPos, type Zone } from './route'

/** [longitude, latitude] of each station in STATIONS order. */
export const STATION_LNGLAT: [number, number][] = [
  [77.2194, 28.6431], // New Delhi
  [77.4322, 28.6506], // Ghaziabad
  [78.0747, 27.8895], // Aligarh Jn
  [78.2336, 27.2077], // Tundla Jn
  [79.0215, 26.7855], // Etawah
  [80.3513, 26.4537], // Kanpur Central
  [81.8287, 25.446], // Prayagraj Jn
]

const lerp = (a: [number, number], b: [number, number], f: number): [number, number] => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]

export function pointOnSegment(segment: number, frac: number): [number, number] {
  const i = Math.max(0, Math.min(STATIONS.length - 2, segment))
  return lerp(STATION_LNGLAT[i], STATION_LNGLAT[i + 1], Math.max(0, Math.min(1, frac)))
}

export const trainLngLat = (p: TrainPos): [number, number] =>
  p.atStation ? STATION_LNGLAT[Math.min(p.stationIdx, STATIONS.length - 1)] : pointOnSegment(p.segment, p.frac)

export const zoneId = (z: Zone) => `${z.kind}-seg${z.segment}`

/** A corridor about 6 km wide around the zone's stretch of track; closed, counter-clockwise ring. */
export function zonePolygon(z: Zone, halfWidthKm = 3): [number, number][] {
  const a = pointOnSegment(z.segment, z.from)
  const b = pointOnSegment(z.segment, z.to)
  const kx = 111.32 * Math.cos(((a[1] + b[1]) / 2) * (Math.PI / 180)) // km per degree of longitude here
  const ky = 110.57
  const dx = (b[0] - a[0]) * kx, dy = (b[1] - a[1]) * ky
  const len = Math.hypot(dx, dy) || 1
  const ox = ((-dy / len) * halfWidthKm) / kx, oy = ((dx / len) * halfWidthKm) / ky
  const ring: [number, number][] = [[a[0] + ox, a[1] + oy], [a[0] - ox, a[1] - oy], [b[0] - ox, b[1] - oy], [b[0] + ox, b[1] + oy]]
  const area = ring.reduce((s, p, i) => {
    const q = ring[(i + 1) % ring.length]
    return s + (p[0] * q[1] - q[0] * p[1])
  }, 0)
  if (area < 0) ring.reverse()
  return [...ring, ring[0]]
}

export const ZONE_POLYGONS = ZONES.map((z) => ({ id: zoneId(z), kind: z.kind, label: z.label, polygon: zonePolygon(z) }))
