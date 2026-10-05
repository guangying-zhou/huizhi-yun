// hzy0-only diagnostic reader. Never print raw PM2 lines or request/response bodies.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const LOG_DIR = '/Users/gavinzhou/.local/state/huizhi-yun/hzy0/pm2/logs'
const APPS = new Set(['console', 'enterprise', 'gateway'])
const EVENTS = new Set([
  'console-auth-dependency-failure', 'console-auth-audit-slow',
  'hzy0-policy-sync', 'hzy0-console-egress', 'hzy0-console-bootstrap-failure', 'hzy0-upstream-failure'
])
const STAGES = new Set(['userinfo', 'jwks', 'runtime-session', 'runtime-jwks', 'verified-policy-binding',
  'verified-policy-store', 'verified-policy-token', 'verified-policy-http',
  'verified-policy-missing', 'verified-policy-invalid', 'enterprise-policy-gate',
  'service-identity', 'service-issue', 'service-token-event',
  'service-token-local-policy', 'service-token-local-runtime',
  'service-token-issue-bootstrap', 'service-token-issue-http',
  'platform-bootstrap-fetch', 'platform-bootstrap-binding',
  'platform-bootstrap',
  'navigation-authorization', 'navigation-aims', 'navigation-assets', 'navigation-codocs',
  'console-permissions-policy', 'console-permissions-audit', 'permissions-token-event',
  'token-event', 'policy-delivery', 'bootstrap', 'sign', 'console-fetch',
  'console-response', 'upstream'])
const PATHS = new Set(['/oauth/token', '/oauth/userinfo', '/api/v1/console/user/permissions', '/api/v1/console/auth/me'])
const ERROR_CLASSES = new Set(['AbortError', 'TimeoutError', 'FetchError', 'HTTPError', 'DependencyError'])
const NETWORK_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH', 'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET'])
const safeStatus = value => Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined
const safeDuration = value => Number.isFinite(value) && value >= 0 && value <= 300_000 ? Math.round(value) : undefined

export function summarizeAuthLogLine(line) {
  const marker = line.indexOf('{"event":"')
  if (marker < 0) return null
  let value
  try { value = JSON.parse(line.slice(marker)) } catch { return null }
  if (!value || !EVENTS.has(value.event)) return null
  const output = { event: value.event }
  if (typeof value.requestId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.requestId)) output.requestId = value.requestId
  if (STAGES.has(value.stage)) output.stage = value.stage
  if (PATHS.has(value.path)) output.path = value.path
  if (ERROR_CLASSES.has(value.errorClass)) output.errorClass = value.errorClass
  if (NETWORK_CODES.has(value.networkCode)) output.networkCode = value.networkCode
  const status = safeStatus(value.status)
  if (status) output.status = status
  if (typeof value.ready === 'boolean') output.ready = value.ready
  for (const key of ['durationMs', 'elapsedMs', 'policyPrepareMs', 'bootstrapMs', 'consoleSyncMs']) {
    const safe = safeDuration(value[key])
    if (safe !== undefined) output[key] = safe
  }
  return output
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = process.argv[2]
  if (!APPS.has(app) || process.argv.length !== 3) throw Error('Use: node safe-auth-log.mjs console|enterprise|gateway')
  const names = readdirSync(LOG_DIR).filter(name => new RegExp(`^hzy0-${app}-(?:out|error)-\\d+\\.log$`).test(name))
  const rows = []
  for (const name of names) {
    const path = resolve(LOG_DIR, name)
    const info = statSync(path)
    if (!info.isFile() || info.uid !== process.getuid()) throw Error('Unexpected hzy0 log ownership')
    const tail = readFileSync(path, 'utf8').slice(-2_000_000)
    for (const line of tail.split('\n')) {
      const row = summarizeAuthLogLine(line)
      if (row) rows.push(row)
    }
  }
  for (const row of rows.slice(-30)) console.log(JSON.stringify(row))
}
