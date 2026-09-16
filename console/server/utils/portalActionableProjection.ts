export type PortalActionableLifecycleState = 'pending' | 'resolved' | 'cancelled'

export interface AdvancePortalActionableLifecycleInput {
  sourceAppCode?: unknown
  actionableKey?: unknown
  expectedVersion?: unknown
  nextVersion?: unknown
  state?: unknown
  recipients?: unknown
}

export interface PortalActionableActor {
  appCode?: string | null
}

export class PortalActionableProjectionError extends Error {
  statusCode: number
  code: string

  constructor(statusCode: number, message: string, code: string) {
    super(message)
    this.name = 'PortalActionableProjectionError'
    this.statusCode = statusCode
    this.code = code
  }
}

function text(value: unknown) {
  return String(value || '').trim()
}

function boundedText(value: unknown, field: string, maxLength: number) {
  const normalized = text(value)
  const hasControl = [...normalized].some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })
  if (!normalized || normalized.length > maxLength || hasControl) {
    throw new PortalActionableProjectionError(400, `${field} is required and must not exceed ${maxLength} characters`, `invalid_${field}`)
  }
  return normalized
}

function actionableState(value: unknown): PortalActionableLifecycleState | null {
  const normalized = text(value).toLowerCase()
  if (!normalized) return null
  if (!['pending', 'resolved', 'cancelled'].includes(normalized)) {
    throw new PortalActionableProjectionError(400, 'metadata.actionableState is invalid', 'invalid_actionable_state')
  }
  return normalized as PortalActionableLifecycleState
}

function normalizedRecipients(value: unknown) {
  if (value === undefined || value === null || value === '') return null
  const raw = Array.isArray(value) ? value : text(value).split(/[,\s|]+/)
  const recipients = [...new Set(raw.map(text).filter(Boolean))].sort()
  if (!recipients.length || recipients.some(uid => uid.toLowerCase() === '@all')) {
    throw new PortalActionableProjectionError(400, 'recipients must contain explicit user UIDs', 'invalid_recipients')
  }
  return recipients
}

export function validatePortalActionableLifecycleInput(
  input: AdvancePortalActionableLifecycleInput,
  actor: PortalActionableActor
) {
  const sourceAppCode = boundedText(actor.appCode, 'source_app_code', 64).toLowerCase()
  const requestedSource = text(input.sourceAppCode).toLowerCase()
  if (requestedSource && requestedSource !== sourceAppCode) {
    throw new PortalActionableProjectionError(403, 'sourceAppCode does not match service identity', 'source_app_mismatch')
  }
  const state = actionableState(input.state)
  if (!state || state === 'pending') {
    throw new PortalActionableProjectionError(400, 'lifecycle state must be resolved or cancelled', 'invalid_actionable_state')
  }
  const expectedVersion = boundedText(input.expectedVersion, 'expected_version', 191)
  const nextVersion = boundedText(input.nextVersion, 'next_version', 191)
  if (expectedVersion === nextVersion) {
    throw new PortalActionableProjectionError(400, 'nextVersion must differ from expectedVersion', 'invalid_next_version')
  }
  return {
    sourceAppCode,
    actionableKey: boundedText(input.actionableKey, 'actionable_key', 191),
    expectedVersion,
    nextVersion,
    state,
    recipients: normalizedRecipients(input.recipients)
  }
}
