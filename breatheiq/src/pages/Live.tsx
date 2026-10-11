import { ArrowRight, Route, Siren, TrainFront } from 'lucide-react'
import { APP } from '../config'
import { go } from '../lib/router'
import { useUi } from '../lib/ui'
import { mmss } from '../lib/format'
import { useSim } from '../sim/engine'
import { STATIONS } from '../sim/route'
import { COACHES, INSTRUMENTED } from '../sim/core'
import { scenarioById } from '../sim/scenarios'
import { computeAqi } from '../sim/aqi'
import { AqiGauge } from '../components/live/Gauge'
import { LcdEmulator } from '../components/live/Lcd'
import { SerialConsole } from '../components/live/SerialConsole'
import { MiniSourceLegend, SensorTiles } from '../components/live/Tiles'
import { LiveChart } from '../components/live/LiveChart'
import { ActuatorCard, PredictionCard } from '../components/live/MlCards'
import { Button, Card, Section, SourceChip } from '../components/ui/primitives'

function JourneyStrip() {
  const train = useSim((s) => s.world.train)
  const next = STATIONS[Math.min(train.stationIdx, STATIONS.length - 1)]
  const from = STATIONS[train.segment]
  return (
    <div className="mt-8 flex flex-wrap items-stretch overflow-hidden rounded-card border border-line bg-surface" aria-label="Journey status">
      <div className="flex items-center gap-3 border-r border-line px-4 py-3">
        <TrainFront size={18} className="text-accent" aria-hidden />
        <div>
          <p className="micro text-muted">Train</p>
          <p className="font-mono text-sm font-medium">{APP.trainId}</p>
        </div>
      </div>
      <div className="border-r border-line px-4 py-3">
        <p className="micro text-muted">{train.atStation ? `At ${next.name} · departs in` : `Next stop · ${next.name}`}</p>
        <p className="font-mono text-sm font-medium tnum">{mmss(train.nextStopIn)}</p>
      </div>
      <div className="border-r border-line px-4 py-3">
        <p className="micro text-muted">Coaches</p>
        <p className="font-mono text-sm font-medium">
          {COACHES.length} · sensor in {COACHES[INSTRUMENTED].code}
        </p>
      </div>
      <div className="min-w-48 flex-1 px-4 py-3">
        <div className="flex items-center justify-between">
          <p className="micro text-muted">
            {from.code} → {next.code}
            {train.zone && <span className="ml-2 text-warn">· {train.zone.label}</span>}
          </p>
          <SourceChip kind="SIM" />
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${train.frac * 100}%` }} />
        </div>
      </div>
    </div>
  )
}

function Hero() {
  const setTour = useUi((s) => s.setTour)
  const setScenario = useSim((s) => s.setScenario)
  return (
    <section className="bg-ruled -mx-4 border-b border-line px-4 pt-12 pb-10 sm:-mx-6 sm:px-6 sm:pt-16">
      <p className="micro text-accent">{APP.track}</p>
      <h1 className="mt-4 max-w-4xl text-[2.5rem] leading-[1.02] font-semibold tracking-[-0.035em] text-balance sm:text-[4rem] lg:text-[4.75rem]">
        {APP.tagline}
      </h1>
      <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted text-pretty sm:text-lg">{APP.lead}</p>
      <div className="mt-7 flex flex-wrap gap-3">
        <Button
          icon={<Siren size={16} aria-hidden />}
          onClick={() => {
            setScenario(7)
            go('playbook')
          }}
        >
          Trigger a bad day
        </Button>
        <Button variant="secondary" icon={<Route size={16} aria-hidden />} onClick={() => setTour(0)}>
          Take the 60-second tour
        </Button>
      </div>
      <JourneyStrip />
    </section>
  )
}

export function LivePage() {
  const history = useSim((s) => s.world.history)
  const r = useSim((s) => s.world.reading)
  const scen = useSim((s) => s.world.scenario.id)
  const aws = useSim((s) => s.source === 'aws')
  const dominant = computeAqi(r.pm25, r.pm10).dominant
  const prev = history[Math.max(0, history.length - 31)]
  const trend = prev ? r.aqi - prev.aqi : 0 // change over the last minute
  return (
    <>
      <Hero />
      <Section
        num="01"
        label="Live cabin"
        title="Every breath, measured."
        lead={`Coach ${COACHES[INSTRUMENTED].code} carries the prototype. Every two seconds its frame reaches AWS IoT Core, a Lambda runs the Random Forest, and the relay command comes back.`}
        aside={<MiniSourceLegend />}
      >
        <div className="grid gap-4 lg:grid-cols-12">
          <Card title="Air quality index" source="SENSOR" service={aws ? 'IoT Core' : undefined} className="lg:col-span-5" tour="gauge">
            <AqiGauge aqi={r.aqi} trend={trend} dominant={dominant} />
            <p className="mt-4 border-t border-line pt-3 text-sm text-muted">
              <span className="micro mr-2 text-ink">Scenario {scen}</span>
              {scenarioById(scen).blurb}
            </p>
          </Card>
          <div className="grid gap-4 lg:col-span-7">
            <Card title="16×2 LCD · on the coach wall" source="SENSOR" tour="lcd">
              <LcdEmulator />
              <p className="mt-3 text-xs text-muted">
                Cycles like <code className="font-mono">loop()</code> in the sketch: splash → PMS → temp/humidity → gas/CO₂ → predictions → verdict.
              </p>
            </Card>
            <div className="grid gap-4 md:grid-cols-2">
              <PredictionCard />
              <ActuatorCard />
            </div>
          </div>
        </div>

        <div className="mt-4">
          <SensorTiles />
        </div>

        <div className="mt-4">
          <LiveChart />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-12">
          <div className="lg:col-span-7">
            <SerialConsole />
          </div>
          <div className="grid content-start gap-4 lg:col-span-5">
            <Card title="Frame anatomy" source="SENSOR">
              <FrameAnatomy />
            </Card>
            <Card title="Where next">
              <ul className="divide-y divide-line">
                {[
                  { page: 'exposure' as const, t: 'Who is breathing the worst air?', d: 'Per-group dose against WHO and NAAQS.' },
                  { page: 'controls' as const, t: 'Why ozone is blocked', d: 'The safety interlock and its event log.' },
                  { page: 'fleet' as const, t: 'The other eleven coaches', d: 'Route, events and a coach × time heat strip.' },
                ].map((l) => (
                  <li key={l.page}>
                    <button type="button" onClick={() => go(l.page)} className="group flex w-full items-center justify-between gap-3 py-2.5 text-left">
                      <span>
                        <span className="block text-sm font-medium group-hover:text-accent">{l.t}</span>
                        <span className="block text-xs text-muted">{l.d}</span>
                      </span>
                      <ArrowRight size={14} className="shrink-0 text-muted group-hover:text-accent" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </div>
      </Section>
    </>
  )
}

function FrameAnatomy() {
  const r = useSim((s) => s.world.reading)
  const pred = useSim((s) => s.world.pred)
  const parts = [
    { k: 'a', v: r.temp.toFixed(2), d: 'Temperature °C · DHT11' },
    { k: 'b', v: String(r.gas), d: 'Gas · MQ-2 · 1 = clear' },
    { k: 'c', v: String(r.co2), d: 'CO₂ · MQ-135 · 1 = clear' },
    { k: 'd', v: String(r.pm1), d: 'PM1.0 standard · PMS7003' },
  ]
  const reply = [
    { k: 't', v: pred.x.value, d: 'X temp → fan' },
    { k: 'u', v: pred.y.value, d: 'Y gas → O₃ 2' },
    { k: 'v', v: pred.z.value, d: 'Z CO₂ → O₃ 1' },
    { k: 'x', v: pred.w.value, d: 'W dust → O₃' },
  ]
  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="micro mb-2 text-muted">Arduino → PC</p>
        <p className="font-mono text-base break-all">
          {parts.map((p) => (
            <span key={p.k}>
              <span className="text-muted">{p.k}</span>
              <span className="text-accent">{p.v}</span>
            </span>
          ))}
          <span className="text-muted">e</span>
        </p>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {parts.map((p) => (
            <div key={p.k} className="contents">
              <dt className="font-mono text-muted">{p.k}…</dt>
              <dd className="text-muted">{p.d}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div>
        <p className="micro mb-2 text-muted">PC → Arduino</p>
        <p className="font-mono text-base">
          {reply.map((p) => (
            <span key={p.k}>
              <span className="text-muted">{p.k}</span>
              <span className={p.v ? 'text-bad' : 'text-accent'}>{p.v}</span>
            </span>
          ))}
          <span className="text-muted">y</span>
        </p>
        <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-muted">
          {reply.map((p) => (
            <dd key={p.k}>
              <span className="font-mono">{p.k}</span> {p.d}
            </dd>
          ))}
        </dl>
      </div>
    </div>
  )
}
