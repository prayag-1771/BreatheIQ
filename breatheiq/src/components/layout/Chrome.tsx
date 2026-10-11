import { AnimatePresence, motion } from 'framer-motion'
import { Cloud, Pause, Play, Siren, Usb } from 'lucide-react'
import { APP } from '../../config'
import { PAGES, go } from '../../lib/router'
import { useSim, clock, SPEEDS } from '../../sim/engine'
import { scenarioById } from '../../sim/scenarios'
import { Logo, StatusPill } from './TopBar'

/** Off-the-chart treatment: hatched page edge + sticky banner. */
export function AlarmLayer() {
  const aqi = useSim((s) => s.world.reading.aqi)
  const badDay = useSim((s) => s.world.badDay.active)
  const off = aqi > 500
  const show = off || badDay
  return (
    <>
      {off && <div className="alarm-frame hatched no-print" aria-hidden />}
      <AnimatePresence>
        {show && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="sticky top-14 z-30 overflow-hidden no-print"
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-3 border-b border-[var(--aqi-verypoor)]/40 bg-[var(--aqi-severe)] px-4 py-2 text-white sm:px-6">
              <Siren size={16} className="shrink-0" aria-hidden />
              <p className="min-w-0 flex-1 text-[0.8125rem] font-medium">
                <span className="micro mr-2 text-[0.6875rem] text-white/80">{off ? 'Off the chart' : 'Bad Day Mode'}</span>
                {off && badDay
                  ? `AQI ${aqi}. Bad Day Mode active — ventilation boosted, sensitive passengers alerted.`
                  : off
                    ? `AQI ${aqi}. The cabin is past the top of the CPCB scale.`
                    : 'Playbook running. Ventilation boosted, advisories out.'}
              </p>
              <button
                type="button"
                onClick={() => go('playbook')}
                className="micro shrink-0 rounded-[4px] border border-white/40 px-2 py-1 text-[0.625rem] text-white hover:bg-white/10"
              >
                Open playbook
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

/** Thin strip with sim clock, scenario, speed and source — always visible. */
export function SimStrip() {
  const t = useSim((s) => s.world.t)
  const scen = useSim((s) => s.world.scenario.id)
  const k = useSim((s) => s.world.intensity)
  const running = useSim((s) => s.running)
  const speed = useSim((s) => s.speed)
  const source = useSim((s) => s.source)
  const setRunning = useSim((s) => s.setRunning)
  const setSpeed = useSim((s) => s.setSpeed)
  const def = scenarioById(scen)
  return (
    <div className="border-b border-line bg-surface/60 no-print">
      <div className="micro mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-5 gap-y-1 px-4 py-1.5 text-[0.625rem] text-muted sm:px-6">
        <span className="tnum">On-board {clock(t)}</span>
        <span className="flex items-center gap-1.5">
          Scenario
          <span className="text-ink">
            {def.id} · {def.short}
          </span>
          {def.id !== 1 && (
            <span className="inline-block h-1 w-12 overflow-hidden rounded-full bg-surface-2" aria-label={`Intensity ${Math.round(k * 100)}%`}>
              <span className="block h-full bg-accent transition-[width]" style={{ width: `${k * 100}%` }} />
            </span>
          )}
        </span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setRunning(!running)}
            className="inline-flex items-center gap-1 rounded-[3px] px-1 hover:text-ink"
            aria-label={running ? 'Pause simulation' : 'Resume simulation'}
          >
            {running ? <Pause size={11} /> : <Play size={11} />}
            {running ? 'Live' : 'Paused'}
          </button>
          <span aria-hidden>·</span>
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSpeed(s)}
              aria-pressed={speed === s}
              className={speed === s ? 'px-0.5 text-accent' : 'px-0.5 hover:text-ink'}
            >
              ×{s}
            </button>
          ))}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          {source === 'serial' ? (
            <>
              <Usb size={11} className="text-accent" aria-hidden /> <span className="text-accent">Arduino on serial</span>
            </>
          ) : source === 'aws' ? (
            <>
              <Cloud size={11} className="text-accent" aria-hidden /> <span className="text-accent">Source · AWS IoT Core</span>
            </>
          ) : (
            'Source · Local engine'
          )}
        </span>
      </div>
    </div>
  )
}

export function Footer() {
  return (
    <footer className="mt-10 border-t border-line no-print">
      <div className="mx-auto grid max-w-[1440px] gap-10 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <div>
          <Logo />
          <p className="mt-3 max-w-xs text-sm text-muted">{APP.tagline} Air-quality monitoring and ML-controlled purification for train cabins.</p>
          <div className="mt-4">
            <StatusPill />
          </div>
        </div>
        <div>
          <p className="micro mb-3 text-muted">Dashboard</p>
          <ul className="space-y-2 text-sm">
            {PAGES.map((p) => (
              <li key={p.id}>
                <a href={`#/${p.id}`} onClick={(e) => { e.preventDefault(); go(p.id) }} className="text-muted hover:text-accent">
                  <span className="font-mono text-xs">{p.num}</span> {p.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="micro mb-3 text-muted">Prototype</p>
          <ul className="space-y-2 text-sm text-muted">
            <li>Arduino Mega 2560</li>
            <li>DHT11 · MQ-2 · MQ-135 · PMS7003</li>
            <li>Random Forest, scikit-learn</li>
            <li>Exhaust fan + 2 ozone relays</li>
            <li>NodeMCU ESP8266 → AWS IoT Core</li>
            <li>AWS: IoT Core · Lambda · SageMaker · Bedrock</li>
          </ul>
        </div>
        <div>
          <p className="micro mb-3 text-muted">Credits</p>
          <p className="text-sm text-muted">
            {APP.track}. Built for the Air track — <em>pollution, exposure, and the days the AQI goes off the chart.</em>
          </p>
          <p className="mt-3 text-xs text-muted">
            AQI uses India&apos;s CPCB National AQI. Guideline values from WHO (2021) and NAAQS (2009). Air-quality guidance only, not medical advice.
          </p>
        </div>
      </div>
    </footer>
  )
}
