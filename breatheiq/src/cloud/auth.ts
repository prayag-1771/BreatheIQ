/**
 * Credentials from the Cognito identity pool. Every visitor has a guest identity (subscribe-only
 * IoT, API calls). Signing in as the operator (Cognito user pool) adds a second identity whose
 * role unlocks Controls; the live MQTT feed always stays on the guest identity, because AWS IoT
 * would also need an IoT policy attached to each signed-in identity.
 */
import type { AwsConfig } from './config'
import type { Credentials } from './sigv4'

interface Session {
  identityId?: string
  creds?: Credentials
  inflight?: Promise<Credentials>
}

const guest: Session = {}
let operator: Session = {}
let idToken: string | null = null

async function cognito<T>(host: string, target: string, body: unknown): Promise<T> {
  const r = await fetch(`https://${host}/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': target },
    body: JSON.stringify(body),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j.message ?? j.__type ?? 'Cognito request failed')
  return j as T
}

async function fetchCredentials(cfg: AwsConfig, s: Session, logins?: Record<string, string>): Promise<Credentials> {
  const host = `cognito-identity.${cfg.region}.amazonaws.com`
  // one identity per visitor and role, reused for every refresh
  s.identityId ??= (await cognito<{ IdentityId: string }>(host, 'AWSCognitoIdentityService.GetId', { IdentityPoolId: cfg.identityPoolId, Logins: logins })).IdentityId
  const { Credentials: c } = await cognito<{ Credentials: { AccessKeyId: string; SecretKey: string; SessionToken: string; Expiration: number } }>(
    host, 'AWSCognitoIdentityService.GetCredentialsForIdentity', { IdentityId: s.identityId, Logins: logins },
  )
  return { accessKeyId: c.AccessKeyId, secretAccessKey: c.SecretKey, sessionToken: c.SessionToken, expiration: c.Expiration * 1000 }
}

function credentialsFor(cfg: AwsConfig, s: Session, logins?: Record<string, string>): Promise<Credentials> {
  if (s.creds && s.creds.expiration - Date.now() > 5 * 60_000) return Promise.resolve(s.creds)
  s.inflight ??= fetchCredentials(cfg, s, logins)
    .then((c) => (s.creds = c))
    .finally(() => { s.inflight = undefined })
  return s.inflight
}

const operatorLogins = (cfg: AwsConfig) => ({ [`cognito-idp.${cfg.region}.amazonaws.com/${cfg.userPoolId}`]: idToken! })

/** Guest credentials: what the MQTT feed uses. */
export const getGuestCredentials = (cfg: AwsConfig) => credentialsFor(cfg, guest)

/** Credentials for API calls: the operator's once signed in, otherwise the guest's. */
export const getCredentials = (cfg: AwsConfig) => (idToken ? credentialsFor(cfg, operator, operatorLogins(cfg)) : credentialsFor(cfg, guest))

export async function signIn(cfg: AwsConfig, username: string, password: string) {
  const r = await cognito<{ AuthenticationResult?: { IdToken: string }; ChallengeName?: string }>(
    `cognito-idp.${cfg.region}.amazonaws.com`, 'AWSCognitoIdentityProviderService.InitiateAuth',
    { AuthFlow: 'USER_PASSWORD_AUTH', ClientId: cfg.userPoolClientId, AuthParameters: { USERNAME: username, PASSWORD: password } },
  )
  if (!r.AuthenticationResult) throw new Error(r.ChallengeName ? `Sign-in needs ${r.ChallengeName}` : 'Sign-in failed')
  idToken = r.AuthenticationResult.IdToken
  operator = {}
  try {
    await getCredentials(cfg)
  } catch (e) {
    signOut()
    throw e
  }
}

export function signOut() {
  idToken = null
  operator = {}
}
