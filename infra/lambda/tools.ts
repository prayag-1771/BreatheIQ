/**
 * The operator tools behind "Ask BreatheIQ", over the live DynamoDB state. The Bedrock Agent
 * calls them through the action-group Lambda (agent-actions.ts); the built-in assistant
 * (breatheiq/src/ask/assistant.ts) calls them directly from the chat Lambda.
 */
import { GetCommand, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'
import { GROUPS, BUDGET, riskFor } from '../../breatheiq/src/sim/exposure'
import { SCENARIOS } from '../../breatheiq/src/sim/scenarios'
import { bandInfo } from '../../breatheiq/src/sim/aqi'
import type { AskTools, CoachRow } from '../../breatheiq/src/ask/assistant'
import { doc, T, KEY, COACH, putControl, getControl } from './shared'

export const getState = async () => (await doc.send(new GetCommand({ TableName: T.state, Key: { pk: KEY } }))).Item

export const ist = (ms: number) => new Date(ms).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false })

interface FleetRow { code: string; kind: string; aqi: number; pm25: number; occupancy: number }

function row(c: FleetRow): CoachRow {
  const instrumented = c.code === COACH
  return {
    coach: c.code, kind: c.kind, aqi: c.aqi, band: bandInfo(c.aqi).label, pm25: c.pm25, occupancy: c.occupancy,
    sensitivePassengers: instrumented ? GROUPS.reduce((s, g) => s + g.count, 0) : Math.round(c.occupancy * 0.31),
    groups: instrumented ? GROUPS.map((g) => ({ name: g.name, count: g.count })) : undefined,
  }
}

export async function listIncidents() {
  const r = await doc.send(new ScanCommand({ TableName: T.incidents, Limit: 100 }))
  return (r.Items ?? []).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
}

const NOT_YET = { error: 'No telemetry has been processed yet.' }

export function serverTools(role: string): AskTools {
  return {
    async getCoachStatus(coach) {
      const s = await getState()
      if (!s) return NOT_YET
      const code = (coach || COACH).toUpperCase()
      const c = (s.fleet as FleetRow[] | undefined)?.find((x) => x.code === code)
      if (!c) return { error: `There is no coach ${code} on this train.` }
      if (code !== COACH) return { ...row(c), instrumented: false }
      const ozone = s.relays?.oz1 || s.relays?.oz2 ? 'running' : s.interlock?.verdict === 'blocked' ? 'blocked by the interlock' : 'off'
      return { ...row(c), instrumented: true, station: s.station, temp: s.reading?.temp, fan: s.relays?.fan, ozone, model: s.model?.version, command: s.command }
    },
    async getWorstCoaches(n) {
      const s = await getState()
      if (!s?.fleet?.length) return NOT_YET
      const rows = (s.fleet as FleetRow[]).map(row).sort((a, b) => b.aqi - a.aqi)
      const clean = rows[rows.length - 1]
      return { worst: rows.slice(0, Math.max(1, Math.min(12, n))), cleanest: { coach: clean.coach, aqi: clean.aqi } }
    },
    async getInterlockLog(sinceMinutes) {
      const from = (Date.now() - Math.max(1, sinceMinutes) * 60_000) * 10
      const r = await doc.send(new QueryCommand({
        TableName: T.interlock, KeyConditionExpression: 'pk = :p AND sk >= :s',
        ExpressionAttributeValues: { ':p': KEY, ':s': from }, ScanIndexForward: false, Limit: 60,
      }))
      return {
        events: (r.Items ?? []).map((e) => ({ time: ist(e.ts), generator: e.gen, verdict: e.verdict, reason: e.reason, aqi: e.aqi, o3ppm: e.o3ppm, occupancy: e.occupancy })),
      }
    },
    async getExposure(group) {
      const s = await getState()
      if (!s?.exposure) return { error: 'No exposure data yet.' }
      const groups = GROUPS.filter((g) => !group || g.id === group).map((g) => {
        const dose = s.exposure.dose?.[g.id] ?? 0
        const rate = s.exposure.doseRate?.[g.id] ?? 0
        return {
          group: g.name, id: g.id, count: g.count, risk: riskFor(g, s.reading.aqi),
          pctWho: Math.round((dose / BUDGET.who) * 100), pctNaaqs: Math.round((dose / BUDGET.naaqs) * 100),
          minutesToWho: rate > 0 && dose < BUDGET.who ? Math.round((BUDGET.who - dose) / rate) : 0,
        }
      })
      return { aqi: s.reading.aqi, groups }
    },
    async getIncident(id) {
      const inc = id ? (await doc.send(new GetCommand({ TableName: T.incidents, Key: { pk: id } }))).Item : (await listIncidents())[0]
      if (!inc) return { error: id ? `There is no incident ${id}.` : 'No Bad Day incident has been recorded yet.' }
      return {
        id: inc.pk, status: inc.status, trigger: inc.trigger, time: ist(inc.startedAt), station: inc.station,
        aqiAtStart: inc.aqi, peakAqi: inc.peakAqi, worstCoach: inc.worstCoach, cleanCoach: inc.cleanCoach,
        interlock: inc.interlock?.verdict ? `${inc.interlock.verdict}${inc.interlock.reason ? ` (${inc.interlock.reason})` : ''}` : undefined,
        staffInstruction: inc.announcement?.staff,
      }
    },
    async setScenario(id) {
      if (role !== 'operator') return { error: 'Only a signed-in operator can change the scenario. Sign in on the Controls page, or use the scenario picker in the header.' }
      const def = SCENARIOS.find((s) => s.id === id)
      if (!def) return { error: `There is no scenario ${id}. Scenarios run from 1 to 7.` }
      const c = await getControl()
      await putControl({ scenario: id, sustain: false, scenarioSeq: c.scenarioSeq + 1 })
      return { name: def.name, note: 'The coach simulator picks it up within a few seconds.' }
    },
  }
}

/** Entry point for the Bedrock Agent action group: function name + string parameters. */
export async function runTool(name: string, p: Record<string, string | undefined>, role: string) {
  const t = serverTools(role)
  switch (name) {
    case 'getCoachStatus': return t.getCoachStatus(p.coach)
    case 'getWorstCoaches': return t.getWorstCoaches(p.n ? Number(p.n) : 3)
    case 'getInterlockLog': return t.getInterlockLog(p.sinceMinutes ? Number(p.sinceMinutes) : 30)
    case 'getExposure': return t.getExposure(p.group)
    case 'getIncident': return t.getIncident(p.id)
    case 'setScenario': return t.setScenario(Number(p.id))
    default: return { error: `Unknown function ${name}.` }
  }
}
