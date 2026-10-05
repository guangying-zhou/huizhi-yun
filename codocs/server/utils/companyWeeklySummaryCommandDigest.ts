import { createHash } from 'node:crypto'

// This command has a fixed, ASCII-only field set. Go's encoding/json sorts map
// keys and HTML-escapes string content when integrationoperation digests it.
function goJSONString(value: unknown): string {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new TypeError('Company summary command is not JSON serializable')
  return encoded.replace(/[<>&\u2028\u2029]/gu, (character) => {
    switch (character) {
      case '<': return '\\u003c'
      case '>': return '\\u003e'
      case '&': return '\\u0026'
      case '\u2028': return '\\u2028'
      default: return '\\u2029'
    }
  })
}

function supportedScalar(value: unknown): boolean {
  return value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isSafeInteger(value))
}

function supportedValue(value: unknown): boolean {
  return supportedScalar(value) || (Array.isArray(value) && value.every(supportedScalar))
}

export function goCompanySummaryCommandJSON(command: Record<string, unknown>): string {
  if (!Object.values(command).every(supportedValue)) {
    throw new TypeError('Company summary command contains unsupported value')
  }
  return `{${Object.keys(command).sort().map(key => `${goJSONString(key)}:${goJSONString(command[key])}`).join(',')}}`
}

export function goCompanySummaryCommandDigest(command: Record<string, unknown>): string {
  return createHash('sha256').update(goCompanySummaryCommandJSON(command), 'utf8').digest('hex')
}

export function matchesCompanySummaryCommandDigest(command: Record<string, unknown>, expected: string): boolean {
  if (!Object.values(command).every(supportedValue)) return false
  const legacyDigest = createHash('sha256').update(JSON.stringify(command), 'utf8').digest('hex')
  return expected === goCompanySummaryCommandDigest(command) || expected === legacyDigest
}
