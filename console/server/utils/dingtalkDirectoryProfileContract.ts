export interface DingTalkDirectoryProfileUser {
  providerSubject: string
  email: string
  name: string
}

export interface DingTalkDirectoryProfileBatch {
  jobId: string
  batchNumber: number
  final: boolean
  provider: 'dingtalk'
  integrationCode: 'dingtalk.default'
  watermark: string
  users: DingTalkDirectoryProfileUser[]
}

export interface DingTalkDirectoryProfileFailure {
  jobId: string
  provider: 'dingtalk'
  integrationCode: 'dingtalk.default'
  watermark: string
  errorCode: string
  errorMessage: string
}

type UnknownRecord = Record<string, unknown>

export class DingTalkDirectoryProfileContractError extends Error {
  statusCode: number

  constructor(statusCode: number, message: string) {
    super(message)
    this.statusCode = statusCode
  }
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {}
}

function text(value: unknown, max = 1000) {
  return String(value || '').trim().slice(0, max)
}

export function normalizeDirectoryEmail(value: unknown) {
  const email = text(value, 255).toLowerCase()
  if (!email || /\s/.test(email) || !/^[^@]+@[^@]+\.[^@]+$/.test(email)) return ''
  return email
}

function jobId(value: unknown) {
  const normalized = text(value, 128)
  if (!/^crj_[A-Za-z0-9_-]{20,64}$/.test(normalized)) {
    throw new DingTalkDirectoryProfileContractError(400, 'jobId 无效')
  }
  return normalized
}

function assertFixedProvider(input: UnknownRecord) {
  if (text(input.provider, 32).toLowerCase() !== 'dingtalk'
    || text(input.integrationCode, 64) !== 'dingtalk.default') {
    throw new DingTalkDirectoryProfileContractError(409, '钉钉目录投影的 provider 或 integrationCode 不匹配')
  }
}

export function parseDingTalkDirectoryProfileBatch(raw: unknown): DingTalkDirectoryProfileBatch {
  const input = record(raw)
  assertFixedProvider(input)
  const rawUsers = Array.isArray(input.users) ? input.users : []
  if (rawUsers.length > 100) {
    throw new DingTalkDirectoryProfileContractError(413, '单批最多接受 100 个钉钉用户')
  }
  const batchNumber = Number(input.batchNumber)
  if (!Number.isInteger(batchNumber) || batchNumber < 1 || batchNumber > 1_000_000) {
    throw new DingTalkDirectoryProfileContractError(400, 'batchNumber 无效')
  }
  return {
    jobId: jobId(input.jobId),
    batchNumber,
    final: input.final === true,
    provider: 'dingtalk',
    integrationCode: 'dingtalk.default',
    watermark: text(input.watermark, 128),
    users: rawUsers.map((value) => {
      const user = record(value)
      return {
        providerSubject: text(user.providerSubject, 255),
        email: normalizeDirectoryEmail(user.email),
        name: text(user.name, 255)
      }
    })
  }
}

export function parseDingTalkDirectoryProfileFailure(raw: unknown): DingTalkDirectoryProfileFailure {
  const input = record(raw)
  assertFixedProvider(input)
  return {
    jobId: jobId(input.jobId),
    provider: 'dingtalk',
    integrationCode: 'dingtalk.default',
    watermark: text(input.watermark, 128),
    errorCode: text(input.errorCode, 100) || 'directory_profile_sync_failed',
    errorMessage: text(input.errorMessage, 1000) || 'Connector Runtime 钉钉目录同步失败'
  }
}
