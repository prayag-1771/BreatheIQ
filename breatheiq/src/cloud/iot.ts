/**
 * AwsIotSource — coach telemetry from AWS IoT Core over MQTT-on-WebSocket, signed with the
 * visitor's Cognito guest credentials (subscribe-only).
 *
 * The local engine is always running. When cloud frames arrive they drive the cabin reading;
 * if they stop for a few seconds the engine carries on by itself, without a gap or a prompt.
 */
import type { MqttClient } from 'mqtt'
import { useSim } from '../sim/engine'
import type { Bit } from '../sim/model'
import type { World } from '../sim/core'
import type { ScenarioId } from '../sim/scenarios'
import type { DataSource, Frame } from '../data/sources'
import { loadConfig, type AwsConfig } from './config'
import { getGuestCredentials } from './auth'
import { presignIotUrl } from './sigv4'
import { useCloud, type CloudFrame } from './store'

const STALE_MS = 9000
const RETRY_MS = 8000

export class AwsIotSource implements DataSource {
  readonly id = 'aws' as const
  private subs = new Set<(f: Frame) => void>()
  private client?: MqttClient
  private cfg: AwsConfig | null = null
  private lastFrameAt = 0
  private watchdog?: number
  private retry?: number
  private stopped = false

  async start() {
    this.stopped = false
    this.cfg = await loadConfig()
    if (!this.cfg) return // no cloud configured: the local engine is the source
    useCloud.getState().set({ config: this.cfg })
    this.watchdog = window.setInterval(() => this.checkStale(), 2000)
    void this.connect()
  }

  private async connect() {
    const cfg = this.cfg
    if (!cfg || this.stopped) return
    if (useCloud.getState().status === 'local') useCloud.getState().set({ status: 'connecting' })
    try {
      const url = await presignIotUrl(cfg.iotEndpoint, cfg.region, await getGuestCredentials(cfg))
      const { default: mqtt } = await import('mqtt')
      const client = mqtt.connect(url, {
        clientId: `breatheiq-web-${Math.random().toString(36).slice(2, 10)}`,
        protocolVersion: 4, keepalive: 30, connectTimeout: 10_000, reconnectPeriod: 0, clean: true,
      })
      this.client = client
      client.on('connect', () => client.subscribe([cfg.telemetryTopic, cfg.commandTopic], { qos: 0 }))
      client.on('message', (topic, payload) => this.onMessage(topic, payload.toString()))
      client.on('close', () => this.scheduleRetry())
      client.on('error', () => client.end(true))
    } catch {
      this.scheduleRetry()
    }
  }

  // the signed URL expires, so reconnects always start from a freshly signed one
  private scheduleRetry() {
    if (this.stopped || this.retry !== undefined) return
    this.retry = window.setTimeout(() => {
      this.retry = undefined
      void this.connect()
    }, RETRY_MS)
  }

  private onMessage(topic: string, raw: string) {
    let m: Record<string, unknown>
    try { m = JSON.parse(raw) } catch { return }
    const cloud = useCloud.getState()
    if (topic === this.cfg?.commandTopic) {
      const frame = m as unknown as CloudFrame
      cloud.set({ frame })
      if (frame.pred) useSim.getState().ingestCloudPred(frame.pred)
      return
    }
    const f = m as {
      ts: number; frame: string; temp: number; gas: Bit; co2: Bit; pm1: number; hum: number; pm25: number; pm10: number
      occupancy: number; scenario: number; o3ppm: number; o3ppm8h: number; routeT?: number
      fleet?: { aqi: number; pm25: number; occupancy: number }[]
      exposure?: NonNullable<NonNullable<World['hw']>['exposure']>
    }
    this.lastFrameAt = Date.now()
    const sim = useSim.getState()
    sim.ingestCloud({
      temp: f.temp, gas: f.gas, co2: f.co2, pm1: f.pm1, hum: f.hum, pm25: f.pm25, pm10: f.pm10, occ: f.occupancy,
      o3: f.o3ppm, o3_8h: f.o3ppm8h, routeT: f.routeT, fleet: f.fleet, exposure: f.exposure,
    })
    if (f.scenario !== sim.world.scenario.id) sim.syncScenario(f.scenario as ScenarioId)
    cloud.set({ status: 'live', latencyS: Math.max(0, Math.round((Date.now() - f.ts) / 100) / 10), frames: cloud.frames + 1 })
    this.subs.forEach((cb) => cb({ raw: f.frame, temp: f.temp, gas: f.gas, co2: f.co2, pm1: f.pm1 }))
  }

  private checkStale() {
    if (useCloud.getState().status === 'live' && Date.now() - this.lastFrameAt > STALE_MS) {
      useCloud.getState().set({ status: 'local', latencyS: null })
      useSim.getState().releaseCloud()
    }
  }

  async stop() {
    this.stopped = true
    window.clearInterval(this.watchdog)
    window.clearTimeout(this.retry)
    this.client?.end(true)
    useCloud.getState().set({ status: 'local', latencyS: null })
    useSim.getState().releaseCloud()
  }

  onFrame(cb: (f: Frame) => void) {
    this.subs.add(cb)
    return () => void this.subs.delete(cb)
  }
}

export const awsIotSource = new AwsIotSource()
