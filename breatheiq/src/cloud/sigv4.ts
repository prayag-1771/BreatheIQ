/** AWS Signature Version 4 with WebCrypto: signed fetch headers and the presigned MQTT-over-WebSocket URL. */
export interface Credentials {
  accessKeyId: string
  secretAccessKey: string
  sessionToken: string
  expiration: number
}

const enc = new TextEncoder()
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
const sha256 = async (data: string) => hex(await crypto.subtle.digest('SHA-256', enc.encode(data)))

async function hmac(key: ArrayBuffer | Uint8Array, data: string) {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', k, enc.encode(data))
}

async function signingKey(secret: string, date: string, region: string, service: string) {
  let k: ArrayBuffer | Uint8Array = enc.encode(`AWS4${secret}`)
  for (const part of [date, region, service, 'aws4_request']) k = await hmac(k, part)
  return k
}

const amzDate = (d = new Date()) => d.toISOString().replace(/[:-]|\.\d{3}/g, '')
/** RFC 3986 encoding, as SigV4 requires for query strings. */
const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

export async function signedHeaders(opts: {
  method: string
  url: string
  body?: string
  service: string
  region: string
  creds: Credentials
}): Promise<Record<string, string>> {
  const u = new URL(opts.url)
  const now = amzDate()
  const date = now.slice(0, 8)
  const payloadHash = await sha256(opts.body ?? '')
  const headers: Record<string, string> = { host: u.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': now, 'x-amz-security-token': opts.creds.sessionToken }
  if (opts.body !== undefined) headers['content-type'] = 'application/json'
  const names = Object.keys(headers).sort()
  const query = [...u.searchParams.entries()].map(([k, v]) => [rfc3986(k), rfc3986(v)] as const).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&')
  const path = u.pathname.split('/').map((seg) => rfc3986(decodeURIComponent(seg))).join('/') || '/'
  const canonical = [opts.method, path, query, ...names.map((n) => `${n}:${headers[n].trim()}`), '', names.join(';'), payloadHash].join('\n')
  const scope = `${date}/${opts.region}/${opts.service}/aws4_request`
  const toSign = ['AWS4-HMAC-SHA256', now, scope, await sha256(canonical)].join('\n')
  const signature = hex(await hmac(await signingKey(opts.creds.secretAccessKey, date, opts.region, opts.service), toSign))
  const { host: _host, ...sendable } = headers
  return { ...sendable, authorization: `AWS4-HMAC-SHA256 Credential=${opts.creds.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` }
}

/** wss:// URL for AWS IoT Core. The session token is appended after signing, as IoT expects. */
export async function presignIotUrl(endpoint: string, region: string, creds: Credentials) {
  const now = amzDate()
  const date = now.slice(0, 8)
  const scope = `${date}/${region}/iotdevicegateway/aws4_request`
  let query = `X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=${rfc3986(`${creds.accessKeyId}/${scope}`)}&X-Amz-Date=${now}&X-Amz-SignedHeaders=host`
  const canonical = ['GET', '/mqtt', query, `host:${endpoint}`, '', 'host', await sha256('')].join('\n')
  const toSign = ['AWS4-HMAC-SHA256', now, scope, await sha256(canonical)].join('\n')
  const signature = hex(await hmac(await signingKey(creds.secretAccessKey, date, region, 'iotdevicegateway'), toSign))
  query += `&X-Amz-Signature=${signature}&X-Amz-Security-Token=${rfc3986(creds.sessionToken)}`
  return `wss://${endpoint}/mqtt?${query}`
}
