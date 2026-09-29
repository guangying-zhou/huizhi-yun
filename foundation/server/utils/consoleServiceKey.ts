import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

// Console steady service identity (R1,
// docs/Console-Runtime-Steady-Identity-Proposal-R1-20260922.md). The Console
// deployment holds an Ed25519 private key; Platform signs its public key into
// the deployment's policy envelope, and Runtime accepts a short assertion
// signed with it for console:service-token:issue while that envelope is valid
// or in outage grace. Used only when the Platform bootstrap token cannot be
// obtained because Platform is unavailable; never for an explicit refusal.
export const CONSOLE_ASSERTION_TYPE = 'hzy-console-assertion+jwt'
export const CONSOLE_ASSERTION_AUDIENCE = 'hzy-runtime-service-token-issue'
export const CONSOLE_ASSERTION_TTL_SECONDS = 60
// Re-register while more than this remains, so the signed key never lapses.
export const CONSOLE_SERVICE_KEY_RENEW_BEFORE_MS = 30 * 86_400_000

export interface ConsoleServiceKey {
  kid: string
  /** Raw 32-byte Ed25519 public key, base64url without padding. */
  publicKey: string
  signingKey: CryptoKey
}

type KeySource = { pem?: string, file?: string }

function sourceFromEnv(env: Record<string, unknown> = {}): KeySource {
  const value = (name: string) => {
    const candidate = env[name] ?? process.env[name]
    return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined
  }
  return { pem: value('HZY_CONSOLE_SERVICE_KEY'), file: value('HZY_CONSOLE_SERVICE_KEY_FILE') }
}

function pkcs8Der(pem: string) {
  const match = /^-----BEGIN PRIVATE KEY-----([A-Za-z0-9+/=\s]+)-----END PRIVATE KEY-----$/.exec(pem.replace(/\\n/g, '\n').trim())
  if (!match) throw new Error('console_service_key_invalid')
  return Uint8Array.from(atob(match[1]!.replace(/\s+/g, '')), character => character.charCodeAt(0))
}

function base64url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64urlText(value: string) {
  return base64url(new TextEncoder().encode(value))
}

export async function consoleServiceKeyId(publicKey: string) {
  const raw = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), character => character.charCodeAt(0))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', raw))
  return `csk_${Array.from(digest.slice(0, 8), byte => byte.toString(16).padStart(2, '0')).join('')}`
}

export async function importConsoleServiceKey(pem: string): Promise<ConsoleServiceKey> {
  const der = pkcs8Der(pem)
  // Import once extractable only to read the public half (JWK `x`), then keep
  // a non-extractable signing key.
  const extractable = await crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, true, ['sign'])
  const jwk = await crypto.subtle.exportKey('jwk', extractable)
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(jwk.x)) {
    throw new Error('console_service_key_invalid')
  }
  const signingKey = await crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign'])
  return { kid: await consoleServiceKeyId(jwk.x), publicKey: jwk.x, signingKey }
}

let cached: { source: string, key: Promise<ConsoleServiceKey | null> } | undefined

/** The configured key, or null when this Console has no steady identity. */
export function loadConsoleServiceKey(env?: Record<string, unknown>): Promise<ConsoleServiceKey | null> {
  const source = sourceFromEnv(env)
  // Read before checking the cache: a same-length replacement at the same
  // path must never keep signing with the previous private key.
  const pem = source.pem ?? (source.file ? readFileSync(source.file, 'utf8') : undefined)
  const identity = pem === undefined ? '' : createHash('sha256').update(pem).digest('hex')
  if (cached?.source === identity) return cached.key
  const key = !identity
    ? Promise.resolve(null)
    : importConsoleServiceKey(pem!)
  // A broken configuration is reported on every use, not cached as absent.
  cached = { source: identity, key }
  key.catch(() => {
    if (cached?.key === key) cached = undefined
  })
  return key
}

export function resetConsoleServiceKeyCache() {
  cached = undefined
}

/** A single-use assertion (fresh jti) for one service-token issue call. */
export async function signConsoleServiceAssertion(
  key: ConsoleServiceKey,
  binding: { tenant: string, deployment: string },
  now = Date.now()
) {
  const issuedAt = Math.floor(now / 1000)
  const subject = `console:${binding.deployment}`
  const header = base64urlText(JSON.stringify({ alg: 'EdDSA', typ: CONSOLE_ASSERTION_TYPE, kid: key.kid }))
  const claims = base64urlText(JSON.stringify({
    iss: subject, sub: subject, aud: CONSOLE_ASSERTION_AUDIENCE, token_use: 'console_service_assertion',
    tenant: binding.tenant, deployment: binding.deployment, scope: 'console:service-token:issue',
    iat: issuedAt, exp: issuedAt + CONSOLE_ASSERTION_TTL_SECONDS, jti: crypto.randomUUID().replace(/-/g, '')
  }))
  const input = `${header}.${claims}`
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key.signingKey, new TextEncoder().encode(input)))
  return `${input}.${base64url(signature)}`
}

export function isConsoleServiceAssertion(token: string) {
  try {
    return JSON.parse(atob(token.split('.')[0]!.replace(/-/g, '+').replace(/_/g, '/'))).typ === CONSOLE_ASSERTION_TYPE
  } catch {
    return false
  }
}
