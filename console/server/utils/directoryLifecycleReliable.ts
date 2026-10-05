import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { createError, getHeader, type H3Event } from 'h3'
import type { ConsoleRuntimeBinding } from './consoleRuntimeBinding'

type Row = Record<string, unknown>
type LifecycleKind = 'employment' | 'offboarding'

const contracts = {
  employment: { operationCode: 'people.directory.employment-sync.v1', capability: 'console:directory-employment:sync', platformCode: 'console.platform.employment-sync.v1', platformCapability: 'platform:employment-authorization:sync' },
  offboarding: { operationCode: 'people.directory.offboarding-disable.v1', capability: 'console:directory-offboarding:disable', platformCode: 'console.platform.offboarding-revoke.v1', platformCapability: 'platform:offboarding-authorization:revoke' }
} as const

const text = (value: unknown) => String(value || '').trim()
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value as Row).sort().map(key => [key, canonical((value as Row)[key])]))
  return value
}

function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

export function parsePeopleDirectoryCommand(raw: unknown, kind: LifecycleKind) {
  const envelope = record(record(raw).serviceCommand)
  const command = record(envelope.command)
  const contract = contracts[kind]
  if (text(envelope.sourceApp) !== 'people' || text(envelope.sourceDeployment) === '' || text(envelope.targetDeployment) === '' || text(envelope.targetApp) !== 'console' || text(envelope.operationCode) !== contract.operationCode
    || text(envelope.requiredCapability) !== contract.capability || text(envelope.commandSchemaVersion) !== 'v1'
    || !text(envelope.operationId) || !text(envelope.idempotencyKey) || !text(command.employeeUid)
    || Number(command.sourceRevision) <= 0 || !/^[a-f0-9]{64}$/.test(text(command.snapshotHash))
    || digest(command) !== text(envelope.commandSha256)) {
    throw createError({ statusCode: 409, statusMessage: 'idempotency_payload_mismatch', message: 'People lifecycle command identity or hash is invalid.' })
  }
  return { envelope, command, contract, uid: text(command.employeeUid), revision: Number(command.sourceRevision), snapshotHash: text(command.snapshotHash) }
}

export function verifyPeopleDirectorySignature(event: H3Event, raw: unknown, binding: ConsoleRuntimeBinding) {
  const envelope = record(record(raw).serviceCommand)
  const command = record(envelope.command)
  const tenant = text(getHeader(event, 'x-hzy-tenant'))
  const sourceDeployment = text(getHeader(event, 'x-hzy-service-command-source-deployment'))
  const targetDeployment = text(getHeader(event, 'x-hzy-service-command-target-deployment'))
  const timestamp = text(getHeader(event, 'x-hzy-service-command-timestamp'))
  const supplied = Buffer.from(text(getHeader(event, 'x-hzy-service-command-signature')), 'hex')
  const bearer = text(getHeader(event, 'authorization')).replace(/^Bearer\s+/i, '')
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp))
  if (tenant !== binding.tenantId || sourceDeployment !== text(envelope.sourceDeployment) || targetDeployment !== binding.deploymentId || targetDeployment !== text(envelope.targetDeployment) || !bearer || !Number.isFinite(age) || age > 60) throw createError({ statusCode: 403, message: 'People lifecycle signature binding invalid' })
  const path = event.path.split('?')[0] || ''
  const message = `POST\n${path}\n${tenant}\n${sourceDeployment}\n${targetDeployment}\npeople\nconsole\n${text(envelope.operationId)}\n${text(envelope.operationCode)}\n${text(envelope.requiredCapability)}\n${text(envelope.idempotencyKey)}\n${text(envelope.commandSchemaVersion)}\n${text(envelope.commandSha256)}\n${text(command.originalActorUid)}\n${timestamp}`
  const expected = createHmac('sha256', bearer).update(message).digest()
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw createError({ statusCode: 403, message: 'People lifecycle signature mismatch' })
}

export function resolvePeopleDirectoryTargetBinding(event: H3Event, actorTenantCode: unknown): ConsoleRuntimeBinding {
  const tenantId = text(actorTenantCode)
  const deploymentId = text(getHeader(event, 'x-hzy-service-command-target-deployment'))
  if (!tenantId || deploymentId !== `${tenantId}-console`) {
    throw createError({ statusCode: 403, message: 'People lifecycle target deployment binding invalid' })
  }
  return { tenantId, deploymentId }
}
