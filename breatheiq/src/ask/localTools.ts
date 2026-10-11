/** Assistant tools over the in-browser engine — what "Ask BreatheIQ" uses when AWS is out of reach. */
import { useSim, clock } from '../sim/engine'
import { COACHES, INSTRUMENTED, coachExtremes, type CoachState } from '../sim/core'
import { GROUPS, BUDGET, riskFor } from '../sim/exposure'
import { bandInfo } from '../sim/aqi'
import { STATIONS } from '../sim/route'
import { SCENARIOS, type ScenarioId } from '../sim/scenarios'
import type { AskTools, CoachRow } from './assistant'

const world = () => useSim.getState().world

function row(c: CoachState, i: number): CoachRow {
  const instrumented = i === INSTRUMENTED
  return {
    coach: COACHES[i].code, kind: COACHES[i].kind, aqi: Math.round(c.aqi), band: bandInfo(c.aqi).label, pm25: Math.round(c.pm25), occupancy: c.occupancy,
    sensitivePassengers: instrumented ? GROUPS.reduce((s, g) => s + g.count, 0) : Math.round(c.occupancy * 0.31),
    groups: instrumented ? GROUPS.map((g) => ({ name: g.name, count: g.count })) : undefined,
  }
}

export const localTools: AskTools = {
  async getCoachStatus(coach) {
    const w = world()
    const code = (coach ?? COACHES[INSTRUMENTED].code).toUpperCase()
    const i = COACHES.findIndex((c) => c.code === code)
    if (i < 0) return { error: `There is no coach ${code} on this train. Coaches: ${COACHES.map((c) => c.code).join(', ')}.` }
    const base = row(w.coaches[i], i)
    if (i !== INSTRUMENTED) return { ...base, instrumented: false }
    const ozone = w.act.oz1On || w.act.oz2On ? 'running' : w.act.oz1Req || w.act.oz2Req ? 'blocked by the interlock' : 'off'
    return {
      ...base, instrumented: true, station: STATIONS[Math.min(w.train.stationIdx, STATIONS.length - 1)].name, temp: w.reading.temp,
      fan: w.act.fanOn, ozone, model: 'four Random-Forest heads', command: `t${w.pred.x.value}u${w.pred.y.value}v${w.pred.z.value}x${w.pred.w.value}y`,
    }
  },
  async getWorstCoaches(n) {
    const w = world()
    const rows = w.coaches.map(row).sort((a, b) => b.aqi - a.aqi)
    const { clean } = coachExtremes(w)
    return { worst: rows.slice(0, Math.max(1, n)), cleanest: { coach: COACHES[clean].code, aqi: Math.round(w.coaches[clean].aqi) } }
  },
  async getInterlockLog(sinceMinutes) {
    const w = world()
    const from = w.t - sinceMinutes * 60
    return {
      events: [...w.interlock.log].reverse().filter((e) => e.t >= from).map((e) => ({
        time: clock(e.t), generator: e.gen, verdict: e.verdict, reason: e.reason, occupancy: Math.round(w.latent.occ), o3ppm: +w.interlock.ppm.toFixed(3),
      })),
    }
  },
  async getExposure(group) {
    const w = world()
    const groups = GROUPS.filter((g) => !group || g.id === group).map((g) => {
      const dose = w.exposure.dose[g.id]
      const rate = w.exposure.doseRate[g.id]
      return {
        group: g.name, id: g.id, count: g.count, risk: riskFor(g, w.reading.aqi),
        pctWho: Math.round((dose / BUDGET.who) * 100), pctNaaqs: Math.round((dose / BUDGET.naaqs) * 100),
        minutesToWho: rate > 0 && dose < BUDGET.who ? Math.round((BUDGET.who - dose) / rate) : 0,
      }
    })
    return { aqi: w.reading.aqi, groups }
  },
  async getIncident() {
    const inc = world().badDay.incident
    if (!inc) return { error: 'No Bad Day incident yet on this journey.' }
    return {
      id: `#${inc.id}`, status: inc.endedAt === null ? 'open' : 'closed', trigger: inc.trigger, time: clock(inc.startedAt), station: inc.station,
      aqiAtStart: inc.before.aqi, peakAqi: inc.peakAqi, worstCoach: inc.worstCoach, cleanCoach: inc.cleanCoach,
    }
  },
  async setScenario(id) {
    const def = SCENARIOS.find((s) => s.id === id)
    if (!def) return { error: `There is no scenario ${id}.` }
    useSim.getState().setScenario(id as ScenarioId)
    return { name: def.name, note: 'The cabin starts changing on the next tick.' }
  },
}
