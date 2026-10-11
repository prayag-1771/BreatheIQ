/**
 * The built-in "Ask BreatheIQ" assistant: picks a tool by intent, runs it, phrases the answer,
 * and answers questions about standards and safety from the Knowledge Base documents, with a
 * citation. The chat Lambda uses it whenever the Bedrock Agent cannot be invoked; the dashboard
 * uses it with the local engine when AWS is out of reach. Same events as the agent stream.
 */
import { SCENARIOS, type ScenarioDef } from '../sim/scenarios'
import { DOCS } from './docs'

export type AskEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string }
  | { type: 'citation'; title: string; snippet: string }
  | { type: 'guardrail' }

export interface CoachRow {
  coach: string
  kind: string
  aqi: number
  band: string
  pm25: number
  occupancy: number
  sensitivePassengers: number
  groups?: { name: string; count: number }[]
}
export interface CoachStatus extends CoachRow {
  instrumented: boolean
  station?: string
  temp?: number
  fan?: boolean
  ozone?: string
  model?: string
  command?: string
}
export interface InterlockEntry {
  time: string
  generator: number
  verdict: string
  reason: string
  aqi?: number
  o3ppm?: number
  occupancy?: number
}
export interface GroupExposure {
  group: string
  id: string
  count: number
  risk: string
  pctWho: number
  pctNaaqs: number
  minutesToWho: number
}
export interface IncidentInfo {
  id: string
  status: string
  trigger: string
  time: string
  station: string
  aqiAtStart: number
  peakAqi: number
  worstCoach: string
  cleanCoach: string
  interlock?: string
  staffInstruction?: string
}
export type Maybe<T> = T | { error: string }

export interface AskTools {
  getCoachStatus(coach?: string): Promise<Maybe<CoachStatus>>
  getWorstCoaches(n: number): Promise<Maybe<{ worst: CoachRow[]; cleanest: { coach: string; aqi: number } }>>
  getInterlockLog(sinceMinutes: number): Promise<Maybe<{ events: InterlockEntry[] }>>
  getExposure(group?: string): Promise<Maybe<{ aqi: number; groups: GroupExposure[] }>>
  getIncident(id?: string): Promise<Maybe<IncidentInfo>>
  setScenario(id: number): Promise<Maybe<{ name: string; note: string }>>
}

const isErr = <T,>(r: Maybe<T>): r is { error: string } => typeof r === 'object' && r !== null && 'error' in r
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function scenarioByText(text: string): ScenarioDef | undefined {
  const t = text.toLowerCase().replace(/-/g, ' ')
  return (
    SCENARIOS.find((s) => t.includes(s.name.toLowerCase()) || t.includes(s.short.toLowerCase())) ??
    (/haze|stubble|crop/.test(t) ? SCENARIOS.find((s) => s.id === 5) : undefined) ??
    (/smoke|gas leak/.test(t) ? SCENARIOS.find((s) => s.id === 4) : undefined) ??
    (/heat/.test(t) ? SCENARIOS.find((s) => s.id === 3) : undefined) ??
    (/tunnel|dust/.test(t) ? SCENARIOS.find((s) => s.id === 6) : undefined) ??
    (/everything|bad day/.test(t) ? SCENARIOS.find((s) => s.id === 7) : undefined) ??
    (/normal|calm/.test(t) ? SCENARIOS.find((s) => s.id === 1) : undefined)
  )
}

// ── Knowledge Base retrieval (paragraph level, keyword overlap) ──
const STOP = new Set('the and for with that this what which who how why are was were does can you from have has its into about than then them they your our when where will would should could there their please tell give'.split(' '))

/** Markdown paragraph → readable plain text (tables become "a · b · c" lines). */
export function plain(md: string) {
  return md
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => !/^\|[-\s|:]+\|$/.test(l.trim()))
    .map((l) => (l.trim().startsWith('|') ? l.split('|').map((c) => c.trim()).filter(Boolean).join(' · ') : l.replace(/^#+\s*/, '').replace(/\*\*/g, '').replace(/`/g, '')))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function retrieve(question: string) {
  const terms = [...new Set(question.toLowerCase().match(/[a-z0-9.₂₃]+/g) ?? [])].map((s) => s.replace(/\.$/, '')).filter((s) => s.length > 2 && !STOP.has(s))
  const scored: { title: string; text: string; score: number; doc: number }[] = []
  DOCS.forEach((d, i) => {
    for (const para of d.text.split(/\n\s*\n/)) {
      if (para.trim().length < 40 || /^#+\s/.test(para.trim()) && !para.trim().includes('\n')) continue
      const hay = para.toLowerCase()
      const title = d.title.toLowerCase()
      const score = terms.reduce((s, t) => s + (hay.includes(t) ? 1 : 0) + (title.includes(t) ? 0.5 : 0), 0)
      if (score > 0) scored.push({ title: d.title, text: para, score, doc: i })
    }
  })
  scored.sort((a, b) => b.score - a.score)
  const top = scored[0]
  if (!top || top.score < 2) return null
  const next = scored.find((p) => p !== top && p.doc === top.doc && p.score >= top.score * 0.6)
  return { title: top.title, text: plain(next ? `${top.text}\n\n${next.text}` : top.text) }
}

const GUARD = /diagnos|medicine|medication|prescri|tablet|\bdrugs?\b|steroid|\bdosage\b|how many puffs|which inhaler|should i take|treat my/
const HELP = 'I can answer questions about the air on this train: the worst and cleanest coaches, a coach’s readings, why ozone was blocked, exposure by passenger group, Bad Day incidents, and the standards BreatheIQ uses (CPCB AQI, WHO, NAAQS, EPA ozone). Try “Which coach has the worst air and who is in it?”'

const GROUP_ID: [RegExp, string][] = [
  [/child|kid/, 'children'], [/elder|old/, 'elderly'], [/asthma|copd|respir/, 'respiratory'], [/pregnan/, 'pregnant'], [/staff|crew|tte/, 'staff'],
]

/** Answer one question, emitting the same events as the Bedrock Agent stream. */
export async function answer(question: string, tools: AskTools, emit: (e: AskEvent) => void) {
  const q = question.trim()
  const t = q.toLowerCase()
  const say = async (text: string) => {
    for (const part of text.match(/\S+\s*/g) ?? []) {
      emit({ type: 'text', delta: part })
      await pause(10)
    }
  }
  const tool = (name: string) => emit({ type: 'tool', name })

  if (GUARD.test(t)) {
    emit({ type: 'guardrail' })
    return say('I can only give air-quality guidance, so I can’t diagnose a condition or suggest a medicine. Please speak to train staff or a doctor. I can tell you which coach has the cleanest air right now.')
  }

  const scenario = /\b(scenario|start|switch|run|trigger)\b/.test(t) ? scenarioByText(t) : undefined
  if (scenario) {
    tool('setScenario')
    const r = await tools.setScenario(scenario.id)
    return say(isErr(r) ? r.error : `Started scenario ${scenario.id} · ${r.name}. ${r.note}`)
  }

  if (/interlock|ozone|o₃|\bo3\b/.test(t) && /why|block|log|when|allow|refus|stop/.test(t)) {
    tool('getInterlockLog')
    const r = await tools.getInterlockLog(180)
    if (isErr(r)) return say(r.error)
    if (!r.events.length) return say('The interlock log has no events in the last three hours: the model has not asked for ozone.')
    const m = q.match(/\b(\d{1,2}):(\d{2})\b/)
    const wanted = m ? `${m[1].padStart(2, '0')}:${m[2]}` : null
    const blocked = r.events.filter((e) => e.verdict === 'blocked')
    const exact = wanted ? r.events.find((e) => e.time.startsWith(wanted) && e.verdict === 'blocked') ?? r.events.find((e) => e.time.startsWith(wanted)) : undefined
    const e = exact ?? blocked[0] ?? r.events[0]
    emit({ type: 'citation', title: 'Ozone safety and the interlock', snippet: 'Ozone may run only when the cabin is unoccupied and the estimated 8-hour average is below 0.07 ppm.' })
    const ctx = [e.occupancy !== undefined && `${e.occupancy} people on board`, e.o3ppm !== undefined && `estimated ozone ${e.o3ppm} ppm`, e.aqi !== undefined && `AQI ${e.aqi}`].filter(Boolean).join(', ')
    const head = e.verdict === 'blocked' ? `Ozone generator ${e.generator} was blocked at ${e.time}: ${e.reason}.` : `At ${e.time} the interlock marked ozone generator ${e.generator} as ${e.verdict}: ${e.reason}.`
    const miss = wanted && !exact ? ` There is no interlock event at ${wanted}; this is the latest one.` : ''
    return say(`${head}${ctx ? ` At that moment: ${ctx}.` : ''} While ozone is blocked, the exhaust fan and filtration run instead. ${blocked.length} block${blocked.length === 1 ? '' : 's'} in the last three hours.${miss}`)
  }

  if (/worst|dirtiest|cleanest|best air|cleaner coach|which coach/.test(t)) {
    tool('getWorstCoaches')
    const r = await tools.getWorstCoaches(3)
    if (isErr(r)) return say(r.error)
    const [w, ...rest] = r.worst
    const who = w.groups?.length ? ` Health flags booked in ${w.coach}: ${w.groups.map((g) => `${g.count} ${g.name.toLowerCase()}`).join(', ')}.` : ''
    return say(`Coach ${w.coach} (${w.kind}) has the worst air: AQI ${w.aqi}, PM2.5 ${w.pm25} µg/m³, ${w.occupancy} people on board, about ${w.sensitivePassengers} of them in a sensitive group.${who} Next worst: ${rest.map((c) => `${c.coach} (AQI ${c.aqi})`).join(', ')}. The cleanest coach is ${r.cleanest.coach} at AQI ${r.cleanest.aqi}.`)
  }

  const group = GROUP_ID.find(([re]) => re.test(t))?.[1]
  if (!/ozone|safe/.test(t) && (/exposure|dose|budget|how long/.test(t) || group)) {
    tool('getExposure')
    const r = await tools.getExposure(group)
    if (isErr(r)) return say(r.error)
    emit({ type: 'citation', title: 'WHO 2021 and India NAAQS limits', snippet: 'Daily dose budget = 24-hour PM2.5 limit × 1440 minutes.' })
    return say(`At cabin AQI ${r.aqi}: ${r.groups.map((x) => `${x.group} (${x.count} on board): ${x.risk} risk, ${x.pctWho}% of the WHO daily budget used (${x.pctNaaqs}% of India NAAQS)${x.minutesToWho ? `, about ${x.minutesToWho} min to the WHO limit at this rate` : ''}`).join('; ')}.`)
  }

  if (/incident|bad day|announcement|report/.test(t) && !/playbook|what happens|steps|how does/.test(t)) {
    tool('getIncident')
    const r = await tools.getIncident()
    if (isErr(r)) return say(r.error)
    return say(`The latest incident (${r.id}) is ${r.status}. Trigger: ${r.trigger}, near ${r.station} at ${r.time}. AQI ${r.aqiAtStart} at the start, peak ${r.peakAqi}. Worst coach ${r.worstCoach}, cleanest ${r.cleanCoach}.${r.interlock ? ` Ozone interlock: ${r.interlock}.` : ''}${r.staffInstruction ? ` Staff instruction: ${r.staffInstruction}` : ''}`)
  }

  const coach = q.match(/\bcoach\s+([A-Za-z]{1,3}\d?)\b/i)?.[1]?.toUpperCase()
  if (coach || /status|right now|current|reading|air now|how is the air/.test(t)) {
    tool('getCoachStatus')
    const r = await tools.getCoachStatus(coach)
    if (isErr(r)) return say(r.error)
    return say(r.instrumented
      ? `Coach ${r.coach}${r.station ? ` near ${r.station}` : ''}: AQI ${r.aqi} (${r.band}), PM2.5 ${r.pm25} µg/m³${r.temp !== undefined ? `, ${r.temp} °C` : ''}, ${r.occupancy} on board. Fan ${r.fan ? 'on' : 'off'}, ozone ${r.ozone ?? 'off'}.${r.model ? ` Model ${r.model} replied ${r.command}.` : ''}`
      : `Coach ${r.coach} (${r.kind}): AQI ${r.aqi} (${r.band}), PM2.5 ${r.pm25} µg/m³, ${r.occupancy} on board, about ${r.sensitivePassengers} in a sensitive group.`)
  }

  const hit = retrieve(q)
  if (hit) {
    tool('Knowledge Base')
    emit({ type: 'citation', title: hit.title, snippet: hit.text.slice(0, 160) })
    return say(hit.text.length > 900 ? `${hit.text.slice(0, 900)}…` : hit.text)
  }
  return say(HELP)
}
