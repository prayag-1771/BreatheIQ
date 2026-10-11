import { create } from 'zustand'
import type { AwsConfig } from './config'

/** What the cloud pipeline said about the latest frame (the `command` topic payload). */
export interface CloudFrame {
  ts: number
  frame: string
  command: string
  topic: string
  commandTopic: string
  reading: { temp: number; hum: number; gas: 0 | 1; co2: 0 | 1; pm1: number; pm25: number; pm10: number; aqi: number }
  occupancy: number
  scenario: number
  station: string
  position?: [number, number]
  zone?: string | null
  preVent?: { active: boolean; zone: string }
  pred: Record<'x' | 'y' | 'z' | 'w', { value: 0 | 1; p: number }>
  model: { version: string; inferenceMs: number }
  relays: { fan: boolean; oz1: boolean; oz2: boolean }
  interlock: { verdict: 'idle' | 'allowed' | 'blocked'; reason: string }
  processMs: number
  badDay: { active: boolean; incidentId: string | null; peakAqi: number }
}

export type CloudStatus = 'local' | 'connecting' | 'live'

interface CloudState {
  config: AwsConfig | null
  status: CloudStatus
  /** device → IoT Core → Lambda → browser, seconds */
  latencyS: number | null
  frame: CloudFrame | null
  frames: number
  role: 'guest' | 'operator'
  set: (patch: Partial<Omit<CloudState, 'set'>>) => void
}

export const useCloud = create<CloudState>((set) => ({
  config: null,
  status: 'local',
  latencyS: null,
  frame: null,
  frames: 0,
  role: 'guest',
  set: (patch) => set(patch),
}))

export const cloudLive = () => useCloud.getState().status === 'live'
