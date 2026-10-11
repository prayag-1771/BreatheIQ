import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import clsx from 'clsx'
import { Pause, Play, RotateCcw, Siren, Snowflake, X, Route } from 'lucide-react'
import { useUi } from '../../lib/ui'
import { useSim, SPEEDS } from '../../sim/engine'
import { SCENARIOS, type ScenarioId } from '../../sim/scenarios'
import { go, type PageId } from '../../lib/router'
import { Button, ServiceChip, Switch } from '../ui/primitives'
import { useCloud } from '../../cloud/store'
import { api } from '../../cloud/api'
import { setSimulator } from '../../cloud/commands'

const TALKING_POINTS = [
  'Trains: cramped cabins, constant turnover, weak ventilation. Air goes bad between stations, fast.',
  'Our prototype: DHT11, MQ-2, MQ-135 and a PMS7003 on an Arduino Mega. A Random Forest on the PC classifies every frame.',
  'Four heads. Temperature drives the exhaust fan; gas, CO₂ and dust drive the ozone generators.',
  'Ozone is hazardous to people, so we built an interlock: ozone only runs in an empty cabin, under 0.07 ppm.',
  'Press 7: the AQI leaves the chart. The train boosts ventilation, alerts the most exposed, drafts the platform announcement.',
  'Exposure page: who is breathing the worst air, how long until they cross the WHO daily limit, in plain language.',
  'On AWS: IoT Core takes each frame, a Lambda runs the model, DynamoDB keeps the record, and Step Functions runs the bad-day playbook: announcement, Polly audio, SNS alerts, report.',
  'Press J and ask: which coach has the worst air? Ask BreatheIQ answers from live coach data.',
  'SENSOR marks what the prototype measures today; SIM marks what we model until the hardware grows. Connect the Arduino and the same dashboard reads it.',
]

/** Start or stop the device simulator Lambda that feeds AWS IoT Core. */
function CloudSimulatorSwitch() {
  const cfg = useCloud((s) => s.config)
  const live = useCloud((s) => s.status === 'live')
  const [on, setOn] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!cfg) return
    api.get<{ control: { simEnabled: boolean } }>('/control').then((r) => setOn(r.control.simEnabled), () => setOn(null))
  }, [cfg])
  if (!cfg) return null
  const toggle = async (v: boolean) => {
    setBusy(true)
    try {
      const r = await setSimulator(v)
      setOn(r.control.simEnabled)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div>
      <p className="micro mb-2 flex items-center gap-2 text-muted">Cloud <ServiceChip name="Lambda" /></p>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>
          Cloud simulator · coach B2
          <span className="block text-xs text-muted">{on === false ? 'Paused: the page runs its local engine.' : live ? 'Publishing a frame every 2 s to AWS IoT Core.' : 'Starting: frames resume within a minute.'}</span>
        </span>
        <Switch checked={on ?? false} onChange={(v) => void toggle(v)} label="Cloud simulator" disabled={busy || on === null} />
      </label>
    </div>
  )
}

export function PresenterPanel() {
  const { presenter, setPresenter, setTour } = useUi()
  const s = useSim()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (presenter) ref.current?.focus()
  }, [presenter])

  return (
    <AnimatePresence>
      {presenter && (
        <>
          <motion.div
            className="fixed inset-0 z-50 bg-black/40 no-print"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPresenter(false)}
            aria-hidden
          />
          <motion.aside
            ref={ref}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label="Presenter panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 38 }}
            className="scroll-thin fixed top-0 right-0 bottom-0 z-50 flex w-full max-w-md flex-col overflow-y-auto border-l border-line bg-surface outline-none no-print"
          >
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <p className="micro text-accent">Presenter</p>
              <button type="button" onClick={() => setPresenter(false)} aria-label="Close presenter panel" className="rounded-card p-1 text-muted hover:text-ink">
                <X size={16} />
              </button>
            </div>
            <div className="space-y-6 p-5">
              <div>
                <p className="micro mb-2 text-muted">Scenario · keys 1–7</p>
                <div className="grid grid-cols-2 gap-2">
                  {SCENARIOS.map((sc) => (
                    <button
                      key={sc.id}
                      type="button"
                      onClick={() => s.setScenario(sc.id as ScenarioId, s.world.scenario.sustain && sc.id !== 1)}
                      className={clsx(
                        'rounded-card border px-3 py-2.5 text-left transition-colors',
                        s.world.scenario.id === sc.id ? 'border-accent bg-accent/10' : 'border-line hover:border-line-strong',
                        sc.id === 7 && 'col-span-2',
                      )}
                    >
                      <span className="font-mono text-xs text-muted">{sc.id}</span>
                      <span className="ml-2 text-sm font-medium">{sc.name}</span>
                    </button>
                  ))}
                </div>
                <label className="mt-3 flex items-center justify-between gap-3 text-sm">
                  <span>
                    Hold scenario at peak
                    <span className="block text-xs text-muted">Stops the ramp-down so you can talk over it.</span>
                  </span>
                  <Switch
                    checked={s.world.scenario.sustain}
                    onChange={(v) => s.setScenario(s.world.scenario.id, v)}
                    label="Hold scenario at peak"
                  />
                </label>
              </div>

              <div>
                <p className="micro mb-2 text-muted">Speed</p>
                <div className="flex gap-2">
                  {SPEEDS.map((sp) => (
                    <button
                      key={sp}
                      type="button"
                      onClick={() => s.setSpeed(sp)}
                      aria-pressed={s.speed === sp}
                      className={clsx('flex-1 rounded-card border py-2 font-mono text-sm', s.speed === sp ? 'border-accent text-accent' : 'border-line text-muted hover:text-ink')}
                    >
                      ×{sp}
                    </button>
                  ))}
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <Button variant="secondary" onClick={() => s.setRunning(!s.running)} icon={s.running ? <Snowflake size={14} /> : <Play size={14} />}>
                    {s.running ? 'Freeze' : 'Resume'}
                  </Button>
                  <Button variant="secondary" onClick={() => s.reset()} icon={<RotateCcw size={14} />}>
                    Reset
                  </Button>
                  <Button
                    variant={s.world.badDay.active ? 'danger' : 'secondary'}
                    onClick={() => s.setBadDay(!s.world.badDay.active)}
                    icon={<Siren size={14} />}
                  >
                    {s.world.badDay.active ? 'Stand down' : 'Bad day'}
                  </Button>
                </div>
              </div>

              <CloudSimulatorSwitch />

              <Button
                variant="primary"
                className="w-full"
                icon={<Route size={14} />}
                onClick={() => {
                  setPresenter(false)
                  setTour(0)
                }}
              >
                Take the 60-second tour
              </Button>

              <div className="rounded-card border border-dashed border-line-strong p-4">
                <p className="micro mb-3 text-warn">Cheat sheet · keep off the projector</p>
                <ol className="space-y-2.5 text-sm leading-snug">
                  {TALKING_POINTS.map((t, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="font-mono text-xs text-muted">{String(i + 1).padStart(2, '0')}</span>
                      <span>{t}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div>
                <p className="micro mb-2 text-muted">Keys</p>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                  {[
                    ['1–7', 'Switch scenario'],
                    ['P · ⌘K', 'Presenter panel'],
                    ['Space', 'Freeze / resume'],
                    ['B', 'Toggle Bad Day Mode'],
                    ['G', 'Start the tour'],
                    ['J', 'Ask BreatheIQ'],
                    ['Esc', 'Close panel / tour'],
                  ].map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt>
                        <kbd className="rounded-[3px] border border-line px-1.5 font-mono text-xs">{k}</kbd>
                      </dt>
                      <dd className="text-muted">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              {!s.running && (
                <p className="flex items-center gap-2 text-xs text-warn">
                  <Pause size={12} /> Simulation frozen.
                </p>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

const TOUR: { page: PageId; target: string; title: string; body: string }[] = [
  { page: 'live', target: 'gauge', title: 'One coach, measured live', body: 'The prototype in coach B2 reads PM, temperature and gases every two seconds. AQI uses India’s CPCB scale and is never clamped at 500.' },
  { page: 'live', target: 'lcd', title: 'Same output as the real box', body: 'The LCD and serial console mirror the Arduino and Python output byte for byte — the a…b…c…d…e frame out, the t·u·v·x·y predictions back.' },
  { page: 'live', target: 'ml', title: 'Four heads, three relays', body: 'Random-Forest heads X/Y/Z/W decide. Temperature runs the exhaust fan; gas, CO₂ and dust request ozone — but only the interlock can say yes.' },
  { page: 'exposure', target: 'groups', title: 'Warn the most exposed', body: 'Children, elderly, asthma/COPD, pregnant passengers and staff each get their own dose, time-to-limit and plain-language advice.' },
  { page: 'playbook', target: 'badday', title: 'Change what happens on bad days', body: 'When the AQI leaves the chart, the train runs a playbook: ventilation boost, advisories, a platform announcement and a coach reshuffle.' },
  { page: 'live', target: 'scenario', title: 'Your turn', body: 'Pick a scenario here or press 1–7. Press 7 for the day everything goes wrong. P opens the presenter panel.' },
]

export function Tour() {
  const { tourStep, setTour } = useUi()
  const [rect, setRect] = useState<DOMRect | null>(null)
  const step = tourStep === null ? null : TOUR[tourStep]

  useEffect(() => {
    if (step) go(step.page)
  }, [step])

  useLayoutEffect(() => {
    if (!step) return
    let raf = 0
    let tries = 0
    const find = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`)
      const visible = el && el.getClientRects().length > 0
      if (visible) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        const update = () => setRect(el.getBoundingClientRect())
        window.setTimeout(update, 350)
        update()
      } else if (tries++ < 30) {
        raf = requestAnimationFrame(find)
      } else {
        setRect(null)
      }
    }
    find()
    const onScroll = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`)
      if (el) setRect(el.getBoundingClientRect())
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [step])

  if (!step || tourStep === null) return null
  const last = tourStep === TOUR.length - 1
  const cardW = Math.min(340, window.innerWidth - 32)
  let top = window.innerHeight - 220
  let left = 16
  if (rect) {
    const below = rect.bottom + 12
    top = below + 200 < window.innerHeight ? below : Math.max(72, rect.top - 212)
    left = Math.min(Math.max(16, rect.left), window.innerWidth - cardW - 16)
  }
  top = Math.min(Math.max(72, top), window.innerHeight - 236)

  return (
    <div className="no-print" role="dialog" aria-label={`Tour step ${tourStep + 1} of ${TOUR.length}`}>
      {rect && (
        <div
          className="pointer-events-none fixed z-[70] rounded-card ring-2 ring-accent transition-all duration-300"
          style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12, boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)' }}
          aria-hidden
        />
      )}
      <div className="fixed z-[71] rounded-card border border-accent/50 bg-surface p-4 shadow-2xl transition-all duration-300" style={{ top, left, width: cardW }}>
        <p className="micro text-accent">
          Tour · {tourStep + 1} / {TOUR.length}
        </p>
        <p className="mt-1.5 text-base font-semibold tracking-tight">{step.title}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted">{step.body}</p>
        <div className="mt-4 flex items-center justify-between">
          <button type="button" onClick={() => setTour(null)} className="text-sm text-muted hover:text-ink">
            Skip tour
          </button>
          <div className="flex gap-2">
            {tourStep > 0 && (
              <Button variant="secondary" onClick={() => setTour(tourStep - 1)}>
                Back
              </Button>
            )}
            <Button onClick={() => setTour(last ? null : tourStep + 1)}>{last ? 'Finish' : 'Next'}</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
