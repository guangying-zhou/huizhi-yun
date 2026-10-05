import { createHash } from 'node:crypto'
import { createError } from 'h3'

type Row = Record<string, unknown>
type OnboardingKind = 'identity-reserve' | 'identity-release' | 'user-provision' | 'operation-status' | 'activation-link'

// 受控入职的跨应用命令族。与 employment/offboarding 生命周期不同，它们由 HR
// 在前台发起并等待结果，因此不进 drain 队列；但信封、HMAC 绑定和 capability
// 模型与既有可靠链路完全一致，幂等键由 onboarding_code + object_version 派生，
// 网络重试不会产生第二次预留或第二个 LDAP 账号。
const contracts = {
  'identity-reserve': {
    operationCode: 'people.directory.identity-reserve.v1',
    capability: 'console:directory-identity:reserve'
  },
  'identity-release': {
    operationCode: 'people.directory.identity-release.v1',
    capability: 'console:directory-identity:reserve'
  },
  'user-provision': {
    operationCode: 'people.directory.user-provision.v1',
    capability: 'console:directory-user:provision'
  },
  'operation-status': {
    operationCode: 'people.directory.user-provision-status.v1',
    capability: 'console:directory-user:provision'
  },
  'activation-link': {
    operationCode: 'people.directory.activation-link.v1',
    capability: 'console:directory-user:provision'
  }
} as const

const text = (value: unknown) => String(value || '').trim()
const record = (value: unknown): Row =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Row).sort().map(key => [key, canonical((value as Row)[key])]))
  }
  return value
}

export function onboardingCommandDigest(command: unknown) {
  return createHash('sha256').update(JSON.stringify(canonical(command))).digest('hex')
}

export function onboardingContractFor(kind: OnboardingKind) {
  return contracts[kind]
}

// parseOnboardingProvisioningCommand 校验命令身份与哈希。任何一项不符都返回 409：
// 调用方送来的信封与它自己声明的哈希不一致时，重放语义已经不可信，
// 继续执行会让同一个幂等键对应两份不同的业务意图。
export function parseOnboardingProvisioningCommand(raw: unknown, kind: OnboardingKind) {
  const envelope = record(record(raw).serviceCommand)
  const command = record(envelope.command)
  const contract = contracts[kind]
  const requiresDingTalkIdentity = kind === 'identity-reserve'
    || kind === 'user-provision'
    || kind === 'activation-link'

  const invalid = text(envelope.sourceApp) !== 'people'
    || text(envelope.targetApp) !== 'console'
    || !text(envelope.sourceDeployment)
    || !text(envelope.targetDeployment)
    || text(envelope.operationCode) !== contract.operationCode
    || text(envelope.requiredCapability) !== contract.capability
    || text(envelope.commandSchemaVersion) !== 'v1'
    || !text(envelope.operationId)
    || !text(envelope.idempotencyKey)
    || !text(command.onboardingCode)
    || text(command.sourceApp) !== 'people'
    || text(command.sourceBizCode) !== text(command.onboardingCode)
    || !text(command.uid)
    || !text(command.actorUid)
    || text(command.actorUid) !== text(command.originalActorUid)
    || Number(command.objectVersion) <= 0
    || (kind === 'user-provision' && !text(command.reservationId))
    || (kind === 'identity-release' && !text(command.reservationId))
    || (kind === 'operation-status' && !text(command.provisionOperationId))
    || (kind === 'activation-link' && (!text(command.provisionOperationId) || !text(command.providerSubject)))
    || (requiresDingTalkIdentity
      && (text(command.providerCode).toLowerCase() !== 'dingtalk' || !text(command.providerSubject)))
    || onboardingCommandDigest(command) !== text(envelope.commandSha256)

  if (invalid) {
    throw createError({
      statusCode: 409,
      statusMessage: 'idempotency_payload_mismatch',
      message: 'Onboarding provisioning command identity or hash is invalid.'
    })
  }

  // dt-* 是本设计要消除的合成主体，在目标侧同样拒绝，不依赖调用方自律。
  const uid = text(command.uid)
  if (uid.toLowerCase().startsWith('dt-')) {
    throw createError({
      statusCode: 400,
      statusMessage: 'onboarding_uid_synthetic',
      message: 'A synthetic dt-* identifier cannot be provisioned as a canonical UID.'
    })
  }

  return { envelope, command, contract, uid, onboardingCode: text(command.onboardingCode) }
}
