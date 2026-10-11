/** The same geography as the Amazon Location map, drawn without tiles — works offline. */
export interface RouteGeo {
  stations: { code: string; name: string; lngLat: [number, number] }[]
  geofences: { id: string; kind: string; label: string; polygon: [number, number][] }[]
}

const BOX = { w: 640, h: 340, lng: [76.8, 82.2], lat: [25.1, 29.0] }
const px = ([lng, lat]: [number, number]) => [
  ((lng - BOX.lng[0]) / (BOX.lng[1] - BOX.lng[0])) * BOX.w,
  BOX.h - ((lat - BOX.lat[0]) / (BOX.lat[1] - BOX.lat[0])) * BOX.h,
]

export function RouteSchematic({ geo, train }: { geo: RouteGeo; train: [number, number] }) {
  const route = geo.stations.map((s) => px(s.lngLat).join(',')).join(' ')
  const [tx, ty] = px(train)
  return (
    <svg viewBox={`0 0 ${BOX.w} ${BOX.h}`} className="h-[340px] w-full rounded-card border border-line bg-bg" role="img" aria-label="Route with pollution-zone geofences and the train position">
      {geo.geofences.map((f) => (
        <g key={f.id}>
          <polygon points={f.polygon.map((p) => px(p).join(',')).join(' ')} fill="var(--warn)" fillOpacity={0.2} stroke="var(--warn)" strokeWidth={1.5} />
        </g>
      ))}
      <polyline points={route} fill="none" stroke="var(--accent)" strokeOpacity={0.8} strokeWidth={3} strokeLinejoin="round" />
      {geo.geofences.map((f) => {
        const c = px(f.polygon[0])
        return (
          <text key={`${f.id}-l`} x={c[0] + 6} y={c[1] - 8} fontSize="10" fill="var(--warn)" fontFamily="var(--font-mono)">
            {f.label}
          </text>
        )
      })}
      {geo.stations.map((s) => {
        const [x, y] = px(s.lngLat)
        return (
          <g key={s.code}>
            <circle cx={x} cy={y} r={5} fill="var(--surface)" stroke="var(--text)" strokeWidth={1.5} />
            <text x={x} y={y + 18} textAnchor="middle" fontSize="10" fill="var(--muted)" fontFamily="var(--font-mono)">
              {s.code}
            </text>
          </g>
        )
      })}
      <g style={{ transform: `translate(${tx}px, ${ty}px)`, transition: 'transform 1.9s linear' }}>
        <circle r={8} fill="var(--accent)" stroke="var(--accent-ink)" strokeWidth={2} />
      </g>
    </svg>
  )
}
