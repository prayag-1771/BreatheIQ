/**
 * Where frames come from. The UI only ever reads the store; a DataSource just
 * feeds it. MockSource runs the local engine and starts with the page.
 * AwsIotSource (cloud/iot.ts) takes over when AWS IoT Core delivers frames.
 * WebSerialSource reads a real Arduino Mega over USB at 115200 baud.
 * ThingSpeakSource is the prototype's original backend.
 */
import { useSim, startEngine, stopEngine } from '../sim/engine'
import type { Bit } from '../sim/model'

export interface Frame {
  raw: string
  temp: number
  gas: Bit
  co2: Bit
  pm1: number
}

export interface DataSource {
  readonly id: 'mock' | 'serial' | 'thingspeak' | 'aws'
  start(): Promise<void>
  stop(): Promise<void>
  onFrame(cb: (f: Frame) => void): () => void
}

const FRAME_RE = /a(-?\d+(?:\.\d+)?)b([01])c([01])d(\d+)e/

/** Parse the firmware's `a{temp}b{gas}c{co2}d{pm}e` line. */
export function parseFrame(line: string): Frame | null {
  const m = FRAME_RE.exec(line)
  if (!m) return null
  return { raw: m[0], temp: parseFloat(m[1]), gas: +m[2] as Bit, co2: +m[3] as Bit, pm1: parseInt(m[4], 10) }
}

class Emitter {
  private subs = new Set<(f: Frame) => void>()
  on(cb: (f: Frame) => void) {
    this.subs.add(cb)
    return () => void this.subs.delete(cb)
  }
  emit(f: Frame) {
    this.subs.forEach((cb) => cb(f))
  }
}

export class MockSource implements DataSource {
  readonly id = 'mock' as const
  private em = new Emitter()
  private unsub?: () => void
  async start() {
    startEngine()
    this.unsub = useSim.subscribe((s, p) => {
      if (s.world.tick !== p.world.tick) {
        const r = s.world.reading
        this.em.emit({ raw: `a${r.temp.toFixed(2)}b${r.gas}c${r.co2}d${r.pm1}e`, temp: r.temp, gas: r.gas, co2: r.co2, pm1: r.pm1 })
      }
    })
  }
  async stop() {
    this.unsub?.()
    stopEngine()
  }
  onFrame(cb: (f: Frame) => void) {
    return this.em.on(cb)
  }
}

// Minimal Web Serial typings (not in lib.dom yet)
interface SerialPortLike {
  open(o: { baudRate: number }): Promise<void>
  close(): Promise<void>
  readable: ReadableStream<Uint8Array> | null
}
interface SerialLike {
  requestPort(): Promise<SerialPortLike>
}

export const webSerialSupported = () => typeof navigator !== 'undefined' && 'serial' in navigator

export class WebSerialSource implements DataSource {
  readonly id = 'serial' as const
  private em = new Emitter()
  private port?: SerialPortLike
  private reader?: ReadableStreamDefaultReader<string>
  private alive = false

  async start() {
    const sim = useSim.getState()
    if (!webSerialSupported()) {
      sim.setSerialStatus('unsupported', 'This browser has no Web Serial. Use Chrome or Edge on desktop.')
      return
    }
    try {
      sim.setSerialStatus('connecting', 'Pick the Arduino Mega (usually COM5 / ttyACM0)…')
      this.port = await (navigator as unknown as { serial: SerialLike }).serial.requestPort()
      await this.port.open({ baudRate: 115200 })
      const decoder = new TextDecoderStream()
      this.port.readable!.pipeTo(decoder.writable as WritableStream<Uint8Array>).catch(() => undefined)
      this.reader = decoder.readable.getReader()
      this.alive = true
      sim.setSource('serial')
      sim.setSerialStatus('connected', 'Connected at 115200 baud. Waiting for a…b…c…d…e frames.')
      void this.pump()
    } catch (e) {
      sim.setSerialStatus('error', e instanceof Error ? e.message : 'Could not open the port.')
    }
  }

  private async pump() {
    let buf = ''
    while (this.alive && this.reader) {
      const { value, done } = await this.reader.read()
      if (done) break
      buf += value
      const lines = buf.split(/\r?\n/)
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const f = parseFrame(line)
        if (f) {
          useSim.getState().ingestHardware(f)
          this.em.emit(f)
        }
      }
    }
  }

  async stop() {
    this.alive = false
    try {
      await this.reader?.cancel()
      await this.port?.close()
    } catch {
      /* port already gone */
    }
    useSim.getState().setSource('mock')
    useSim.getState().setSerialStatus('idle')
  }

  onFrame(cb: (f: Frame) => void) {
    return this.em.on(cb)
  }
}

/** Reads a ThingSpeak channel feed (the prototype's original backend; AWS IoT Core replaces it). */
export class ThingSpeakSource implements DataSource {
  readonly id = 'thingspeak' as const
  private em = new Emitter()
  private timer?: number
  private channelId: string
  private readKey: string
  constructor(channelId: string, readKey: string) {
    this.channelId = channelId
    this.readKey = readKey
  }
  async start() {
    const poll = async () => {
      const url = `https://api.thingspeak.com/channels/${encodeURIComponent(this.channelId)}/feeds/last.json?api_key=${encodeURIComponent(this.readKey)}`
      const res = await fetch(url)
      if (!res.ok) return
      const j = (await res.json()) as Record<string, string>
      // final.py writes field1 = Temperature, field2 = Gas, field3 = Pms
      const f: Frame = { raw: '', temp: +j.field1, gas: +j.field2 as Bit, co2: 1, pm1: +j.field3 }
      this.em.emit(f)
    }
    this.timer = window.setInterval(() => void poll(), 15000)
    await poll()
  }
  async stop() {
    window.clearInterval(this.timer)
  }
  onFrame(cb: (f: Frame) => void) {
    return this.em.on(cb)
  }
}

export const mockSource = new MockSource()
export const serialSource = new WebSerialSource()
