// Log redaction. The Worker code logs through `console.*`; the host wraps those
// methods so configured secrets, bearer credentials, JWT-shaped strings and
// credential-bearing query parameters never reach stdout/journald.
const JWT = /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/g
const BEARER = /\b(Bearer|Basic)\s+[^\s"',;]+/gi
const QUERY_SECRET = /([?&](?:code|token|access_token|refresh_token|id_token|client_secret|state|ticket|signature)=)[^&\s"']+/gi
const HEADER_SECRET = /((?:x-hzy-gateway-token|x-hzy-data-runtime-token|x-hzy-scheduler-signature|authorization|cookie)["']?\s*[:=]\s*["']?)[^\s"',;]+/gi

export function createRedactor(secrets = []) {
  const values = [...new Set(secrets.filter(value => typeof value === 'string' && value.length >= 8))]
    .sort((left, right) => right.length - left.length)
  const redactString = (input) => {
    let text = String(input)
    for (const value of values) text = text.split(value).join('[redacted]')
    return text
      .replace(JWT, '[redacted-jwt]')
      .replace(BEARER, '$1 [redacted]')
      .replace(QUERY_SECRET, '$1[redacted]')
      .replace(HEADER_SECRET, '$1[redacted]')
  }
  return function redact(value) {
    if (value instanceof Error) {
      // Stacks and nested causes are dropped: only the class and a redacted message.
      return `${safeName(value.name)}: ${redactString(value.message).slice(0, 500)}`
    }
    if (typeof value === 'string') return redactString(value)
    if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') return value
    try {
      return redactString(JSON.stringify(value, (key, item) => (item instanceof Error ? `${safeName(item.name)}` : item)))
    } catch {
      return '[unserializable]'
    }
  }
}

export function installConsoleRedaction(redact, target = console) {
  const original = {}
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) {
    original[method] = target[method].bind(target)
    target[method] = (...args) => original[method](...args.map(arg => redact(arg)))
  }
  return () => Object.assign(target, original)
}

/** Structured JSON line logger; callers pass only non-secret fields. */
export function createLogger(redact, sink = line => process.stdout.write(`${line}\n`)) {
  return (event, fields = {}) => {
    sink(redact(JSON.stringify({ time: new Date().toISOString(), event, ...fields })))
  }
}

export function safeName(value) {
  const name = String(value || 'Error')
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : 'Error'
}
