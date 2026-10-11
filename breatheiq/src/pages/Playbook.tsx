import clsx from 'clsx'
import { ArrowRight, Download, Megaphone, MessageSquare, Siren, Train } from 'lucide-react'
import { useSim, clock } from '../sim/engine'
import { COACHES, coachExtremes, advisoriesSent, type Incident, type World } from '../sim/core'
import { SCENARIOS, type ScenarioId } from '../sim/scenarios'
import { STATIONS } from '../sim/route'
import { bandInfo } from '../sim/aqi'
import { GROUPS } from '../sim/exposure'
import { APP } from '../config'
import { download } from '../lib/storage'
import { AqiBadge, Button, Card, Empty, Pill, Section, Switch } from '../components/ui/primitives'
import { CloudPlaybook } from '../components/playbook/CloudPlaybook'
import { useCloud } from '../cloud/store'

function announcement(inc: Incident, w: World) {
  const next = STATIONS[Math.min(w.train.stationIdx, STATIONS.length - 1)].name
  return `Attention please. Passengers of train ${APP.trainId} arriving at ${next}: air quality inside coach ${inc.worstCoach} is currently very poor. Passengers with children, elderly travellers, pregnant passengers and anyone with asthma are requested to move to coach ${inc.cleanCoach}, where the air is cleaner. Railway staff on the platform will assist you. Please keep doors and windows closed while the train is in the haze belt. Thank you.`
}

function sms(inc: Incident) {
  return `🚆 ${APP.trainId} air alert: air in coach ${inc.worstCoach} is very poor right now (AQI ${inc.peakAqi}). If you have asthma, are pregnant, elderly or travelling with children, please move to coach ${inc.cleanCoach} — staff will help. Keep your inhaler and a mask handy. Reply STOP to opt out.`
}

function exportReport(inc: Incident, w: World) {
  const rows = inc.actions
    .map((a) => `<tr><td>${clock(a.t)}</td><td><b>${a.title}</b><br>${a.detail}</td></tr>`)
    .join('')
  const r = w.reading
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${APP.name} incident report #${inc.id}</title>
<style>body{font:14px/1.5 Inter,system-ui,sans-serif;color:#0e1722;max-width:760px;margin:40px auto;padding:0 20px}h1{font-size:28px;letter-spacing:-.02em;margin:0 0 4px}
.mono{font-family:ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#5b6b7a}
table{width:100%;border-collapse:collapse;margin:12px 0}td,th{border-top:1px solid #dde3e9;padding:8px;text-align:left;vertical-align:top}th{font-family:ui-monospace,monospace;font-size:11px;text-transform:uppercase;color:#5b6b7a}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.box{border:1px solid #dde3e9;border-radius:7px;padding:12px}.warn{background:#fff7e6;border:1px solid #f5c26b;border-radius:7px;padding:8px 12px;font-size:12px}
blockquote{border-left:3px solid #0f766e;margin:8px 0;padding:4px 12px;color:#334}</style></head><body>
<p class="mono">${APP.name} · Incident report #${inc.id}</p>
<h1>Bad Day Mode — ${APP.trainId}</h1>
<p>Started ${clock(inc.startedAt)}${inc.endedAt !== null ? `, ended ${clock(inc.endedAt)}` : ' (still active at export)'} near ${inc.station}. Trigger: ${inc.trigger}.</p>
<p class="warn">Exported from the ${APP.name} dashboard's in-browser engine.</p>
<div class="grid"><div class="box"><p class="mono">Before</p>AQI ${inc.before.aqi} (${bandInfo(inc.before.aqi).label})<br>PM2.5 ${inc.before.pm25} µg/m³<br>Fan ${inc.before.fanRpm} rpm<br>Ozone: ${inc.before.ozone}<br>Advisories sent: 0</div>
<div class="box"><p class="mono">After / now</p>AQI ${r.aqi} (${bandInfo(r.aqi).label})<br>PM2.5 ${r.pm25} µg/m³<br>Fan ${w.act.fanRpm} rpm<br>Ozone: ${w.act.oz1On || w.act.oz2On ? 'Running (interlock allowed)' : w.act.oz1Req || w.act.oz2Req ? 'Blocked by interlock' : 'Off'}<br>Advisories sent: ${advisoriesSent(inc)}</div></div>
<p><b>Peak AQI:</b> ${inc.peakAqi}. <b>Worst coach:</b> ${inc.worstCoach}. <b>Cleanest coach:</b> ${inc.cleanCoach}.</p>
<h2>Timeline</h2><table><tr><th>Time</th><th>Action</th></tr>${rows}</table>
<h2>Platform announcement</h2><blockquote>${announcement(inc, w)}</blockquote>
<h2>Passenger advisory</h2><blockquote>${sms(inc)}</blockquote>
<p class="mono">Standards referenced: CPCB National AQI · WHO AQG 2021 · NAAQS 2009 · US EPA ozone 0.07 ppm (8-h)</p>
</body></html>`
  download(`breatheiq-incident-${inc.id}.html`, html, 'text/html')
}

function BeforeAfter({ inc, w }: { inc: Incident; w: World }) {
  const { worst } = coachExtremes(w)
  const ozNow = w.act.oz1On || w.act.oz2On ? 'Running · cabin empty' : w.act.oz1Req || w.act.oz2Req ? 'Requested · BLOCKED (occupied)' : 'Off'
  const rows: [string, string, string, boolean][] = [
    ['Cabin AQI', String(inc.before.aqi), String(w.reading.aqi), w.reading.aqi < inc.before.aqi],
    ['PM2.5', `${inc.before.pm25} µg/m³`, `${w.reading.pm25} µg/m³`, w.reading.pm25 < inc.before.pm25],
    ['Exhaust fan', inc.before.fanRpm ? `${inc.before.fanRpm} rpm` : 'Off', w.act.fanRpm ? `${w.act.fanRpm} rpm` : 'Off', w.act.fanRpm > inc.before.fanRpm],
    ['Ozone', inc.before.ozone, ozNow, true],
    ['Air changes / hour', String(inc.before.achPerHour), w.badDay.active ? '14' : '8', w.badDay.active],
    ['Advisories sent', '0', String(advisoriesSent(inc)), advisoriesSent(inc) > 0],
    ['Sensitive in worst coach', String(inc.before.sensitiveInWorst), inc.actions.some((a) => a.step === 5) ? `${Math.round(inc.before.sensitiveInWorst * 0.3)} (rest → ${inc.cleanCoach})` : String(inc.before.sensitiveInWorst), inc.actions.some((a) => a.step === 5)],
  ]
  return (
    <Card title="Before / after" source="SIM">
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-line pb-2">
        <p className="micro text-muted">Before · {clock(inc.startedAt)}</p>
        <span />
        <p className="micro text-right text-accent">After · now</p>
      </div>
      <dl className="divide-y divide-line">
        {rows.map(([label, b, a, better]) => (
          <div key={label} className="py-2.5">
            <dt className="micro mb-1 text-muted">{label}</dt>
            <dd className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 font-mono text-sm">
              <span className="text-muted">{b}</span>
              <ArrowRight size={13} className="text-muted" aria-hidden />
              <span className={clsx('text-right', better && 'text-accent')}>{a}</span>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-muted">Worst coach right now: {COACHES[worst].code}. Re-allocation target: {inc.cleanCoach}.</p>
    </Card>
  )
}

export function PlaybookPage() {
  const w = useSim((s) => s.world)
  const setBadDay = useSim((s) => s.setBadDay)
  const setScenario = useSim((s) => s.setScenario)
  const inc = w.badDay.incident
  const active = w.badDay.active
  const off = w.reading.aqi > 500
  const cloud = useCloud((s) => s.config !== null)

  return (
    <Section
      num="07"
      label="Playbook · Bad Day Mode"
      title="When the AQI leaves the chart, the train responds."
      lead="Bad Day Mode switches on by itself past AQI 500, or by hand. It runs a fixed playbook in seconds — and leaves a paper trail."
    >
      <div className="grid gap-4 lg:grid-cols-12">
        <Card className={clsx('lg:col-span-5', active && 'border-[var(--aqi-verypoor)]/60')} tour="badday" title="Bad Day Mode" source="SIM">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-2xl font-semibold tracking-tight">{active ? 'Active' : 'Standing by'}</p>
              <p className="mt-1 text-sm text-muted">
                {active ? `Since ${clock(inc!.startedAt)} · ${inc!.trigger}` : 'Arms automatically when cabin AQI passes 500.'}
              </p>
            </div>
            <Switch checked={active} onChange={setBadDay} label="Bad Day Mode" size="lg" />
          </div>
          <div className="mt-4 flex items-center gap-3 rounded-card border border-line bg-surface-2 px-3 py-2">
            <span className="font-mono text-2xl font-semibold">{w.reading.aqi}</span>
            <AqiBadge aqi={w.reading.aqi} size="md" />
            {off && <Pill tone="bad">Off the chart</Pill>}
          </div>
          <p className="micro mt-5 mb-2 text-muted">Rehearse a bad day</p>
          <ul className="grid gap-1.5">
            {SCENARIOS.filter((s) => s.id !== 1).map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setScenario(s.id as ScenarioId)}
                  className={clsx('flex w-full items-center gap-3 rounded-card border px-3 py-2 text-left text-sm', w.scenario.id === s.id ? 'border-accent bg-accent/10' : 'border-line hover:border-line-strong')}
                >
                  <kbd className="font-mono text-xs text-muted">{s.id}</kbd>
                  <span className="flex-1">{s.name}</span>
                  {(s.id === 5 || s.id === 7) && <Pill tone="bad">AQI 500+</Pill>}
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <div className="grid content-start gap-4 lg:col-span-7">
          {!inc ? (
            <Card title="Incident">
              <Empty>
                No bad day yet. Press <kbd className="font-mono">7</kbd> or{' '}
                <button type="button" className="text-accent underline underline-offset-2" onClick={() => setScenario(7)}>
                  trigger everything at once
                </button>{' '}
                — the playbook arms itself when the AQI passes 500 (about 15 s at ×1).
              </Empty>
            </Card>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <BeforeAfter inc={inc} w={w} />
                <Card
                  title="Auto-actions"
                  source="SIM"
                  actions={
                    cloud ? undefined : (
                      <Button variant="secondary" className="!px-2 !py-1 text-xs" icon={<Download size={12} />} onClick={() => exportReport(inc, w)}>
                        Export incident report
                      </Button>
                    )
                  }
                >
                  <ol className="relative space-y-4 border-l border-line pl-5">
                    {inc.actions.map((a) => (
                      <li key={`${a.step}-${a.t}`} className="relative">
                        <span className={clsx('absolute top-1 -left-[25px] h-2.5 w-2.5 rounded-full border-2 border-surface', a.step === 99 ? 'bg-ok' : 'bg-accent')} aria-hidden />
                        <p className="font-mono text-[0.6875rem] text-muted">{clock(a.t)}</p>
                        <p className="text-sm font-medium">{a.title}</p>
                        <p className="text-xs text-muted">{a.detail}</p>
                      </li>
                    ))}
                  </ol>
                  {inc.endedAt === null && inc.actions.length < 7 && <p className="mt-3 font-mono text-xs text-muted pulse-soft">Running playbook…</p>}
                </Card>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Card title="Platform announcement · draft" source="SIM">
                  <div className="flex gap-3">
                    <Megaphone size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden />
                    <p className="text-sm leading-relaxed">{announcement(inc, w)}</p>
                  </div>
                  <p className="mt-3 text-xs text-muted">Sent to the station master at {STATIONS[Math.min(w.train.stationIdx, STATIONS.length - 1)].name} for approval. Not broadcast automatically.</p>
                </Card>
                <Card title="Passenger advisory · preview" source="SIM">
                  <div className="rounded-[14px] bg-[#0b141a] p-3">
                    <div className="mb-2 flex items-center gap-2 text-xs text-white/70">
                      <Train size={14} aria-hidden /> BreatheIQ Alerts
                      <MessageSquare size={12} className="ml-auto" aria-hidden />
                    </div>
                    <div className="max-w-[92%] rounded-[10px] rounded-tl-[2px] bg-[#1f2c34] px-3 py-2 text-[0.8125rem] leading-snug text-white">
                      {sms(inc)}
                      <p className="mt-1 text-right text-[0.625rem] text-white/50">{clock(inc.startedAt + 4)} ✓✓</p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-muted">
                    Goes to passengers who ticked a health flag at booking: {GROUPS.filter((g) => g.id !== 'staff').map((g) => g.name.toLowerCase()).join(', ')}.
                  </p>
                </Card>
              </div>
            </>
          )}
        </div>
      </div>
      <CloudPlaybook />
      {active && (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted">
          <Siren size={14} className="text-bad" aria-hidden /> Fan boost and filtration are lowering cabin PM by roughly a fifth against what it would be without the playbook.
        </p>
      )}
    </Section>
  )
}
