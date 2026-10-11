import { useState } from 'react'
import clsx from 'clsx'
import { useReducedMotion } from 'framer-motion'
import { CheckCircle2, CircleDashed, Cloud, Plug, Settings2, Unplug, X } from 'lucide-react'
import { Line, LineChart, ResponsiveContainer, YAxis } from 'recharts'
import { useSim } from '../sim/engine'
import { serialSource, webSerialSupported } from '../data/sources'
import { useNow } from '../lib/hooks'
import { hms } from '../lib/format'
import { Button, Card, Pill, Section, SourceChip, Tabs } from '../components/ui/primitives'
import { CloudDiagram } from '../components/system/CloudDiagram'
import { useCloud } from '../cloud/store'
import { APP } from '../config'

interface NodeDef {
  id: string
  x: number
  y: number
  w: number
  h: number
  title: string
  sub: string
  role: string
  pins: string
  std: string
  source: 'SENSOR' | 'SIM'
}

const NODES: NodeDef[] = [
  { id: 'dht', x: 10, y: 20, w: 150, h: 46, title: 'DHT11', sub: 'Temp · humidity', role: 'Reads cabin temperature and humidity once per loop.', pins: 'Data → D8 · 5 V', std: 'ASHRAE 41.1 / ISO 7726 placement', source: 'SENSOR' },
  { id: 'mq2', x: 10, y: 86, w: 150, h: 46, title: 'MQ-2', sub: 'Smoke / LPG', role: 'Digital comparator out: 1 = clear, 0 = gas detected.', pins: 'DO → A0 (read digitally) · 5 V', std: 'Heater needs 24 h burn-in', source: 'SENSOR' },
  { id: 'mq135', x: 10, y: 152, w: 150, h: 46, title: 'MQ-135', sub: 'CO₂ / NH₃ / VOC', role: 'Digital comparator out: 1 = clear, 0 = detected.', pins: 'DO → A1 (read digitally) · 5 V', std: 'WHO Indoor Air Quality Guidelines', source: 'SENSOR' },
  { id: 'pms', x: 10, y: 218, w: 150, h: 46, title: 'PMS7003', sub: 'PM1.0 / 2.5 / 10', role: 'Laser particle counter, 32-byte frames with checksum at 9600 baud.', pins: 'SoftwareSerial RX 11 / TX 12 · 5 V, 3.3 V TTL', std: 'GB/T 18801-2015 reference sensor class', source: 'SENSOR' },
  { id: 'mega', x: 250, y: 100, w: 170, h: 90, title: 'Arduino Mega 2560', sub: 'Frames · actuates', role: 'Builds a{temp}b{gas}c{co2}d{pm}e every loop, reads t·u·v·x·y back, drives relays and the LCD.', pins: 'USB Serial 115200 · Serial1 → ESP8266', std: 'UART 115200 8N1, 5 V TTL', source: 'SENSOR' },
  { id: 'pc', x: 520, y: 20, w: 190, h: 64, title: 'PC · final.py', sub: 'Random Forest × 4', role: 'Parses the frame, runs four RandomForestClassifier heads, writes predictions back, uploads to ThingSpeak.', pins: 'COM5 · pyserial · scikit-learn · requests', std: 'test_size 0.2, random_state 42', source: 'SENSOR' },
  { id: 'relay', x: 520, y: 120, w: 190, h: 64, title: 'Relay board', sub: 'Fan · O₃ 1 · O₃ 2', role: 'Active-low relays. LOW = on. Fan on X; ozone on Y/Z/W, gated by the interlock.', pins: 'Fan D26 · O₃1 D53 · O₃2 D51', std: 'US EPA O₃ 0.07 ppm (8-h) interlock', source: 'SENSOR' },
  { id: 'lcd', x: 520, y: 210, w: 190, h: 54, title: '16×2 LCD', sub: 'HD44780', role: 'Cycles readings and the verdict; first abnormal head wins.', pins: 'RS 2 · EN 3 · D4–D7 → 4–7', std: '—', source: 'SENSOR' },
  { id: 'esp', x: 250, y: 280, w: 170, h: 54, title: 'NodeMCU ESP8266', sub: 'Wi-Fi bridge', role: 'Forwards frames from Serial1 to the cloud.', pins: 'Serial1 115200 · 3.3 V logic', std: 'Wi-Fi 802.11 b/g/n, 2.4 GHz', source: 'SENSOR' },
  { id: 'ts', x: 520, y: 290, w: 190, h: 54, title: 'ThingSpeak', sub: 'Channel · 4 fields', role: 'Stores the time series. final.py writes field1 temp, field2 gas, field3 PM.', pins: 'HTTPS GET /update', std: '15 s free-tier update limit', source: 'SENSOR' },
  { id: 'dash', x: 790, y: 150, w: 180, h: 64, title: 'This dashboard', sub: 'BreatheIQ', role: 'Reads the store. Frames come from AWS IoT Core, the in-browser engine when offline, or Web Serial at 115200 with a cable.', pins: 'AwsIotSource · MockSource · WebSerialSource', std: 'CPCB AQI · WHO 2021 · NAAQS', source: 'SIM' },
]

const EDGES: { id: string; d: string; label?: string; dashed?: boolean }[] = [
  { id: 'e-dht', d: 'M160 43 C 205 43, 205 125, 250 125' },
  { id: 'e-mq2', d: 'M160 109 C 205 109, 205 138, 250 138' },
  { id: 'e-mq135', d: 'M160 175 C 205 175, 205 152, 250 152' },
  { id: 'e-pms', d: 'M160 241 C 205 241, 205 168, 250 168' },
  { id: 'e-up', d: 'M420 118 C 470 118, 470 46, 520 46', label: 'a…e frame' },
  { id: 'e-down', d: 'M520 66 C 480 66, 470 136, 420 136', label: 't·u·v·x·y' },
  { id: 'e-relay', d: 'M420 152 C 470 152, 470 152, 520 152' },
  { id: 'e-lcd', d: 'M420 176 C 470 176, 470 237, 520 237' },
  { id: 'e-esp', d: 'M335 190 L 335 280', label: 'Serial1' },
  { id: 'e-ts', d: 'M420 307 C 470 307, 470 317, 520 317' },
  { id: 'e-pc-ts', d: 'M710 60 C 760 110, 760 260, 710 300', dashed: true },
  { id: 'e-dash', d: 'M710 317 C 760 317, 750 182, 790 182' },
  { id: 'e-serial', d: 'M420 110 C 560 0, 700 0, 790 165', dashed: true, label: 'Web Serial (optional)' },
]

function Pipeline() {
  const [active, setActive] = useState<string>('mega')
  const reduce = useReducedMotion()
  const tick = useSim((s) => s.world.tick)
  const node = NODES.find((n) => n.id === active)!
  const flowing = ['e-dht', 'e-mq2', 'e-mq135', 'e-pms', 'e-up', 'e-down', 'e-relay', 'e-esp', 'e-ts', 'e-dash']
  return (
    <div className="grid gap-4 lg:grid-cols-12">
      <div className="scroll-thin -mx-4 overflow-x-auto px-4 lg:col-span-9">
        <svg viewBox="0 0 980 350" className="min-w-[760px]" role="group" aria-label="Hardware pipeline from sensors to dashboard">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M0 0 L10 5 L0 10 z" fill="var(--border-strong)" />
            </marker>
          </defs>
          {EDGES.map((e) => (
            <g key={e.id}>
              <path id={e.id} d={e.d} fill="none" stroke={e.dashed ? 'var(--border-strong)' : 'var(--accent)'} strokeOpacity={e.dashed ? 1 : 0.45} strokeWidth={1.5} className={e.dashed ? undefined : 'dash-flow'} strokeDasharray={e.dashed ? '4 5' : undefined} markerEnd="url(#arrow)" />
              {e.label && (
                <text fontSize="9.5" fill="var(--muted)" fontFamily="var(--font-mono)" dy={-4}>
                  <textPath href={`#${e.id}`} startOffset="50%" textAnchor="middle">
                    {e.label}
                  </textPath>
                </text>
              )}
            </g>
          ))}
          {!reduce &&
            flowing.map((id, i) => (
              <circle key={`${id}-${tick}`} r={3.5} fill="var(--accent)">
                <animateMotion dur="1.4s" begin={`${(i % 5) * 0.12}s`} fill="freeze" repeatCount="1">
                  <mpath href={`#${id}`} />
                </animateMotion>
              </circle>
            ))}
          {NODES.map((n) => (
            <g
              key={n.id}
              role="button"
              tabIndex={0}
              aria-label={`${n.title}: ${n.role}`}
              aria-pressed={active === n.id}
              onMouseEnter={() => setActive(n.id)}
              onFocus={() => setActive(n.id)}
              onClick={() => setActive(n.id)}
              className="cursor-pointer outline-none"
            >
              <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={7} fill="var(--surface)" stroke={active === n.id ? 'var(--accent)' : 'var(--border-strong)'} strokeWidth={active === n.id ? 2 : 1} />
              <text x={n.x + 12} y={n.y + 20} fontSize="12.5" fontWeight={600} fill="var(--text)">
                {n.title}
              </text>
              <text x={n.x + 12} y={n.y + 36} fontSize="10" fill="var(--muted)" fontFamily="var(--font-mono)">
                {n.sub}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <Card title="Node" source={node.source} className="lg:col-span-3">
        <p className="text-lg font-semibold tracking-tight">{node.title}</p>
        <p className="mt-1 text-sm text-muted">{node.role}</p>
        <dl className="mt-4 space-y-3 text-sm">
          <div>
            <dt className="micro text-muted">Pins / link</dt>
            <dd className="font-mono text-[0.8125rem]">{node.pins}</dd>
          </div>
          <div>
            <dt className="micro text-muted">Standard / note</dt>
            <dd className="font-mono text-[0.8125rem]">{node.std}</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-muted">Hover or tab through the diagram.</p>
      </Card>
    </div>
  )
}

function SensorHealth() {
  const tick = useSim((s) => s.world.tick)
  const t = useSim((s) => s.world.t)
  const source = useSim((s) => s.source)
  const flakyPms = tick % 60 >= 44 && tick % 60 < 50
  const flakyEsp = tick % 85 >= 70 && tick % 85 < 76
  const rows = [
    { name: 'DHT11', status: 'ok', last: 0, noise: '±0.06 °C', drift: '+0.1 °C / 24 h' },
    { name: 'MQ-2', status: 'ok', last: 0, noise: 'digital', drift: 'heater stable' },
    { name: 'MQ-135', status: 'ok', last: 0, noise: 'digital', drift: 'recal. due in 41 d' },
    { name: 'PMS7003', status: flakyPms ? 'degraded' : 'ok', last: flakyPms ? (tick % 60) - 43 : 0, noise: flakyPms ? 'checksum failures' : '±2.5 %', drift: 'fan 1,200 h' },
    { name: 'Relay board', status: 'ok', last: 0, noise: '—', drift: '3 relays, active-low' },
    { name: 'ESP8266 Wi-Fi', status: flakyEsp ? 'reconnecting' : 'ok', last: flakyEsp ? ((tick % 85) - 69) * 2 : 0, noise: flakyEsp ? 'RSSI −88 dBm' : 'RSSI −61 dBm', drift: '—' },
  ]
  return (
    <Card title="Sensor health" source="SIM">
      <div className="scroll-thin overflow-x-auto">
        <table className="w-full min-w-[540px] text-sm">
          <thead>
            <tr className="micro text-left text-muted">
              <th className="py-2 font-normal">Device</th>
              <th className="py-2 font-normal">Status</th>
              <th className="py-2 font-normal">Uptime</th>
              <th className="py-2 font-normal">Last packet</th>
              <th className="py-2 font-normal">Noise</th>
              <th className="py-2 font-normal">Drift</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.name}>
                <td className="py-2 font-medium">{r.name}</td>
                <td className="py-2">
                  {r.status === 'ok' ? (
                    <Pill tone="ok" icon={<CheckCircle2 size={10} />}>OK</Pill>
                  ) : (
                    <Pill tone="warn" icon={<CircleDashed size={10} className="spin" />}>{r.status}</Pill>
                  )}
                </td>
                <td className="py-2 font-mono text-xs">{hms(t + 3 * 3600 + 1200)}</td>
                <td className={clsx('py-2 font-mono text-xs', r.last > 4 && 'text-warn')}>{r.last ? `${r.last * 2} s ago` : 'just now'}</td>
                <td className="py-2 font-mono text-xs text-muted">{r.noise}</td>
                <td className="py-2 font-mono text-xs text-muted">{r.drift}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">{source === 'serial' ? 'Hardware connected — rows still simulated; firmware does not report health yet.' : 'Simulated health; flaky rows recover on their own.'}</p>
    </Card>
  )
}

function ThingSpeakPanel() {
  const history = useSim((s) => s.world.history)
  const lastTickAt = useSim((s) => s.lastTickAt)
  const now = useNow(1000)
  const [settings, setSettings] = useState(false)
  const [channel, setChannel] = useState('')
  const [key, setKey] = useState('')
  const data = history.slice(-40)
  const fields = [
    { n: 1, name: 'Temperature', k: 'temp' as const, note: 'final.py: field1' },
    { n: 2, name: 'Gas', k: 'gas' as const, note: 'final.py: field2' },
    { n: 3, name: 'PM (Pms)', k: 'pm1' as const, note: 'final.py: field3' },
    { n: 4, name: 'CO₂', k: 'co2' as const, note: 'proposed — not uploaded yet' },
  ]
  const ago = Math.max(0, Math.round((now - lastTickAt) / 1000))
  return (
    <Card
      title="ThingSpeak channel · mirror"
      source="SIM"
      actions={
        <button type="button" onClick={() => setSettings(!settings)} className="text-muted hover:text-ink" aria-label="ThingSpeak settings" aria-expanded={settings}>
          <Settings2 size={14} />
        </button>
      }
    >
      {settings && (
        <div className="mb-4 rounded-card border border-dashed border-line-strong p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="micro text-muted">ThingSpeakSource</p>
            <div className="flex items-center gap-2">
              <Pill tone="muted">Replaced by AWS IoT Core</Pill>
              <button type="button" onClick={() => setSettings(false)} aria-label="Close settings" className="text-muted hover:text-ink">
                <X size={13} />
              </button>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="text-xs">
              <span className="text-muted">Channel ID</span>
              <input value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="e.g. 2571234" className="mt-1 w-full rounded-card border border-line bg-bg px-2 py-1.5 font-mono text-sm" />
            </label>
            <label className="text-xs">
              <span className="text-muted">Read API key</span>
              <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="read key, not the write key" className="mt-1 w-full rounded-card border border-line bg-bg px-2 py-1.5 font-mono text-sm" />
            </label>
          </div>
          <p className="mt-2 text-xs text-muted">The prototype first uploaded to ThingSpeak. AWS IoT Core is now the device backbone; these fields show where the original channel plugs in, and nothing is fetched.</p>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => (
          <div key={f.n} className="rounded-card border border-line p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                <span className="font-mono text-xs text-muted">Field {f.n}</span> {f.name}
              </p>
              <span className="font-mono text-sm">{data.length ? data[data.length - 1][f.k] : '—'}</span>
            </div>
            <div className="mt-2 h-16" aria-hidden>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                  <YAxis hide domain={f.k === 'gas' || f.k === 'co2' ? [-0.2, 1.2] : ['auto', 'auto']} />
                  <Line dataKey={f.k} stroke={f.n === 4 ? 'var(--border-strong)' : 'var(--series-1)'} strokeWidth={1.5} dot={false} isAnimationActive={false} type={f.k === 'gas' || f.k === 'co2' ? 'stepAfter' : 'monotone'} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="mt-1 flex justify-between font-mono text-[0.625rem] text-muted">
              <span>{f.note}</span>
              <span>last entry {ago}s ago</span>
            </p>
          </div>
        ))}
      </div>
    </Card>
  )
}

function ConnectCard() {
  const status = useSim((s) => s.serialStatus)
  const msg = useSim((s) => s.serialMessage)
  const hw = useSim((s) => s.world.hw)
  const supported = webSerialSupported()
  return (
    <Card title="Connect real Arduino" source="SENSOR">
      <p className="text-sm text-muted">
        Plug the Mega in over USB and the same dashboard reads real frames at 115200 baud. Fields the firmware does not send — humidity over serial, PM2.5, PM10, occupancy, ozone — stay <SourceChip kind="SIM" className="align-middle" />.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {status === 'connected' ? (
          <Button variant="secondary" icon={<Unplug size={14} />} onClick={() => void serialSource.stop()}>
            Disconnect
          </Button>
        ) : (
          <Button icon={<Plug size={14} />} onClick={() => void serialSource.start()} disabled={status === 'connecting'}>
            {status === 'connecting' ? 'Waiting for port…' : 'Connect real Arduino'}
          </Button>
        )}
        {!supported && <Pill tone="warn">Web Serial needs Chrome or Edge</Pill>}
      </div>
      {msg && (
        <p className={clsx('mt-3 text-sm', status === 'error' || status === 'unsupported' ? 'text-warn' : 'text-muted')} role="status">
          {msg}
        </p>
      )}
      {hw && <p className="mt-2 font-mono text-xs text-accent">Last hardware frame: a{hw.temp.toFixed(2)}b{hw.gas}c{hw.co2}d{hw.pm1}e</p>}
      <div className="mt-4 rounded-card border border-line bg-surface-2 p-3 text-xs text-muted">
        <p className="micro mb-1 text-ink">Firmware notes</p>
        <ul className="list-disc space-y-1 pl-4">
          <li>The frame forwards only one PM value (PM1.0 standard, <code className="font-mono">data.pm10_standard</code>). Adding PM2.5 and PM10 to the frame is the next firmware step.</li>
          <li>Close the Python script first — only one program can hold COM5.</li>
          <li>Relays latch on until the model reports “All are normal”.</li>
        </ul>
      </div>
    </Card>
  )
}

const STANDARDS = [
  { name: 'US EPA ozone limit', detail: '0.07 ppm, 8-hour average — enforced by the interlock', done: true },
  { name: 'WHO Indoor Air Quality Guidelines', detail: 'PM2.5 15 µg/m³ · PM10 45 µg/m³ (24-h, AQG 2021)', done: true },
  { name: 'India NAAQS 2009', detail: 'PM2.5 60 µg/m³ · PM10 100 µg/m³ (24-h)', done: true },
  { name: 'CPCB National AQI', detail: 'Sub-indices for PM2.5 and PM10, AQI = max', done: true },
  { name: 'GB/T 18801-2015', detail: 'Air purifier performance (CADR) — test planned', done: false },
  { name: 'ASHRAE 41.1 / ISO 7726', detail: 'Temperature measurement & sensor placement', done: false },
  { name: 'Sensor datasheets', detail: 'PMS7003 · DHT11 · MQ-2 · MQ-135 within rated ranges', done: true },
]

/** Which device is feeding the dashboard right now. */
function ActiveDevice() {
  const source = useSim((s) => s.source)
  const live = useCloud((s) => s.status === 'live')
  const label = source === 'serial' ? 'Arduino Mega 2560 · Web Serial' : live ? `Cloud simulator · coach ${APP.coach}` : `Local engine · coach ${APP.coach}`
  return (
    <div className="rounded-card border border-line bg-surface px-4 py-3">
      <p className="micro text-muted">Active device</p>
      <p className="mt-1 flex items-center gap-2 font-mono text-sm">
        <span className={clsx('h-1.5 w-1.5 rounded-full', live || source === 'serial' ? 'bg-ok' : 'bg-muted')} aria-hidden />
        {label}
      </p>
    </div>
  )
}

export function SystemPage() {
  const cloud = useCloud((s) => s.config !== null)
  // follows the AWS config (which loads just after first paint) until someone picks a tab
  const [picked, setTab] = useState<'cloud' | 'hardware' | null>(null)
  const tab = picked ?? (cloud ? 'cloud' : 'hardware')
  return (
    <Section
      num="06"
      label="System"
      title="From a sensor on the wall to a decision in two seconds."
      lead="The prototype node by node, and the AWS pipeline it feeds: IoT Core, Lambda, SageMaker, DynamoDB, Step Functions and Bedrock."
      aside={<ActiveDevice />}
    >
      <Tabs
        label="System view"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'cloud', label: 'Cloud · AWS' },
          { id: 'hardware', label: 'Hardware' },
        ]}
      />
      <div className="mt-4">
        {tab === 'cloud' ? (
          <Card title="AWS pipeline" service="CloudWatch">
            <CloudDiagram />
          </Card>
        ) : (
          <Card title="Hardware pipeline" source="SENSOR">
            <Pipeline />
          </Card>
        )}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <SensorHealth />
        <ConnectCard />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <ThingSpeakPanel />
        </div>
        <Card title="Standards & compliance" className="lg:col-span-5">
          <ul className="divide-y divide-line">
            {STANDARDS.map((s) => (
              <li key={s.name} className="flex items-start gap-3 py-2.5">
                {s.done ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-ok" aria-label="Addressed" /> : <CircleDashed size={16} className="mt-0.5 shrink-0 text-muted" aria-label="Planned" />}
                <span>
                  <span className="block text-sm font-medium">{s.name}</span>
                  <span className="block text-xs text-muted">{s.detail}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
            <Cloud size={12} aria-hidden /> CARB and US EPA both warn against ozone generators in occupied rooms.
          </p>
        </Card>
      </div>
    </Section>
  )
}
