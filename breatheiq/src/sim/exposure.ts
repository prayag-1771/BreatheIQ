import { LIMITS } from './aqi'

export type GroupId = 'children' | 'elderly' | 'respiratory' | 'pregnant' | 'staff'

export interface GroupDef {
  id: GroupId
  name: string
  who: string
  /** inhaled-dose multiplier vs. a resting adult (breathing rate × sensitivity) */
  factor: number
  /** AQI at which we start warning this group */
  warnAt: number
  count: number // passengers of this group in the instrumented coach (SIM)
}

export const GROUPS: GroupDef[] = [
  { id: 'children', name: 'Children', who: 'Under 12 · faster breathing, developing lungs', factor: 1.5, warnAt: 100, count: 9 },
  { id: 'elderly', name: 'Elderly', who: '65+ · heart and lung strain', factor: 1.3, warnAt: 100, count: 7 },
  { id: 'respiratory', name: 'Asthma / COPD', who: 'Known respiratory illness', factor: 1.7, warnAt: 80, count: 4 },
  { id: 'pregnant', name: 'Pregnant', who: 'Exposure linked to low birth weight', factor: 1.3, warnAt: 100, count: 2 },
  { id: 'staff', name: 'Rail staff', who: 'TTEs, pantry, cleaners · 8-h shifts walking every coach', factor: 1.2, warnAt: 150, count: 6 },
]

/** Daily dose budgets in µg·min/m³ (24-h mean × 1440 min). */
export const BUDGET = {
  who: LIMITS.whoPm25 * 1440,
  naaqs: LIMITS.naaqsPm25 * 1440,
}

/** Staff arrive with half a shift already logged at a typical 45 µg/m³. */
export const STAFF_PRELOAD = 45 * 240 * 1.2

export type Risk = 'low' | 'elevated' | 'high' | 'critical'

export function riskFor(g: GroupDef, aqi: number): Risk {
  const eff = aqi * (g.factor / 1.3)
  if (eff < g.warnAt) return 'low'
  if (eff < 220) return 'elevated'
  if (eff < 420) return 'high'
  return 'critical'
}

export const ADVICE: Record<GroupId, Record<Risk, string>> = {
  children: {
    low: 'Air is fine. No action needed.',
    elevated: 'Keep kids seated away from the doors when the train stops.',
    high: 'Move children to coach {clean} (cleanest air) and keep the window shut.',
    critical: 'Masks on for children now; staff are moving families to {clean}.',
  },
  elderly: {
    low: 'Air is fine. No action needed.',
    elevated: 'Take it slow when walking between coaches.',
    high: 'Stay seated, sip water, tell staff if you feel chest tightness.',
    critical: 'Wear an N95 if you have one. Staff can move you to a cleaner coach.',
  },
  respiratory: {
    low: 'Air is fine. Keep your inhaler handy as usual.',
    elevated: 'Keep your reliever inhaler within reach.',
    high: 'Use your reliever if wheezy. Ask staff for a seat in {clean}.',
    critical: 'Inhaler and mask now. Staff have been alerted to your seat.',
  },
  pregnant: {
    low: 'Air is fine. No action needed.',
    elevated: 'Avoid the vestibules and door areas.',
    high: 'Move to a cleaner coach if you can; staff will help with bags.',
    critical: 'Mask on and move to {clean} now. Staff have been asked to assist.',
  },
  staff: {
    low: 'Normal duties.',
    elevated: 'Limit time in vestibules and the pantry car.',
    high: 'Wear N95 on rounds; rotate who covers the worst coaches.',
    critical: 'N95 mandatory. Rounds every 20 min only; swap staff after 60 min.',
  },
}
