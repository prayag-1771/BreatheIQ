/**
 * Amazon Location Service map (MapLibre GL + an Amazon Location API key): the route, the
 * pollution-zone geofences and the train. Loaded lazily; Fleet shows RouteSchematic offline.
 */
import { useEffect, useRef } from 'react'
import { Map as MapLibre, Marker, setWorkerUrl, type GeoJSONSource } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { RouteGeo } from './RouteSchematic'

// MapLibre looks for its worker next to its own file, which a bundle moves; point it at the emitted copy
setWorkerUrl(workerUrl)

const COLORS = {
  dark: { route: '#5eead4', fence: '#fbbf24', train: '#5eead4', ink: '#042f2e' },
  light: { route: '#0f766e', fence: '#a16207', train: '#0f766e', ink: '#ffffff' },
}

const trainFeature = (p: [number, number]) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'Point' as const, coordinates: p } })

export default function RouteMap({ apiKey, region, theme, geo, train, onFail }: {
  apiKey: string
  region: string
  theme: 'dark' | 'light'
  geo: RouteGeo
  train: [number, number]
  onFail: () => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<MapLibre | null>(null)
  const trainRef = useRef(train)

  useEffect(() => {
    trainRef.current = train
    const src = map.current?.getSource('train') as GeoJSONSource | undefined
    src?.setData(trainFeature(train))
  }, [train])

  useEffect(() => {
    if (!box.current) return
    const c = COLORS[theme]
    const style = `https://maps.geo.${region}.amazonaws.com/v2/styles/Standard/descriptor?key=${encodeURIComponent(apiKey)}&color-scheme=${theme === 'dark' ? 'Dark' : 'Light'}`
    const m = new MapLibre({
      container: box.current, style, bounds: [[76.8, 25.1], [82.2, 29.0]], fitBoundsOptions: { padding: 24 },
      attributionControl: { compact: true }, cooperativeGestures: true,
    })
    map.current = m
    let loaded = false
    const giveUp = window.setTimeout(() => { if (!loaded) onFail() }, 8000)
    m.on('error', () => { if (!loaded) onFail() })
    m.on('load', () => {
      loaded = true
      window.clearTimeout(giveUp)
      m.addSource('route', { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: geo.stations.map((s) => s.lngLat) } } })
      m.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': c.route, 'line-width': 3, 'line-opacity': 0.8 } })
      m.addSource('fences', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: geo.geofences.map((f) => ({ type: 'Feature', properties: { label: f.label }, geometry: { type: 'Polygon', coordinates: [f.polygon] } })) },
      })
      m.addLayer({ id: 'fences-fill', type: 'fill', source: 'fences', paint: { 'fill-color': c.fence, 'fill-opacity': 0.22 } })
      m.addLayer({ id: 'fences-line', type: 'line', source: 'fences', paint: { 'line-color': c.fence, 'line-width': 1.5 } })
      m.addSource('train', { type: 'geojson', data: trainFeature(trainRef.current) })
      m.addLayer({ id: 'train', type: 'circle', source: 'train', paint: { 'circle-radius': 7, 'circle-color': c.train, 'circle-stroke-color': c.ink, 'circle-stroke-width': 2 } })
      for (const s of geo.stations) {
        const el = document.createElement('div')
        el.className = 'micro rounded-[3px] border border-line bg-surface/90 px-1 text-[0.5625rem] text-ink'
        el.textContent = s.code
        el.title = s.name
        new Marker({ element: el, anchor: 'top', offset: [0, 6] }).setLngLat(s.lngLat).addTo(m)
      }
    })
    return () => {
      window.clearTimeout(giveUp)
      m.remove()
      map.current = null
    }
  }, [apiKey, region, theme, geo, onFail])

  return <div ref={box} className="h-[340px] w-full overflow-hidden rounded-card border border-line" role="img" aria-label="Map of the route with pollution-zone geofences and the train position" />
}
