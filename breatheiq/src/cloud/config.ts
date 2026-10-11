/**
 * Cloud endpoints, written by `scripts/post-deploy.mjs` to /aws-config.json. Nothing in it
 * is secret. When the file is missing or unreachable the dashboard stays on the local engine.
 */
export interface AwsConfig {
  region: string
  apiUrl: string
  chatUrl: string
  iotEndpoint: string
  identityPoolId: string
  userPoolId: string
  userPoolClientId: string
  trainId: string
  coach: string
  telemetryTopic: string
  commandTopic: string
  mapKey: string | null
  mapStyle: string
  siteUrl: string | null
}

let pending: Promise<AwsConfig | null> | null = null

export function loadConfig(): Promise<AwsConfig | null> {
  pending ??= fetch(`${import.meta.env.BASE_URL}aws-config.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? (r.json() as Promise<AwsConfig>) : null))
    .then((c) => (c && c.iotEndpoint && c.identityPoolId && c.apiUrl ? c : null))
    .catch(() => null)
  return pending
}
