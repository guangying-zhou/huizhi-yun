import { createError, getHeader, type H3Event } from 'h3'
import { resolveConsoleRuntimeBaseUrl } from '@hzy/foundation/server/utils/consoleRuntime'
import { resolveServiceAppBaseUrl } from '@hzy/foundation/server/utils/serviceAppUrl'
import {
  fetchConsoleServiceJson,
  requestWithServiceAccessToken,
  trustedServiceRequestHeaders
} from '@hzy/foundation/server/utils/serviceOidc'

type Row = Record<string, unknown>
export type OnboardingProvisioningKind = 'identity-reserve' | 'identity-release' | 'user-provision' | 'operation-status' | 'activation-link'

// 受控入职的跨应用命令族。
//
// 与 employment/offboarding 生命周期不同，它们由 HR 在前台发起并等待结果，
// 因此不进 drain 队列。信封、HMAC 绑定和 capability 模型与既有可靠链路一致，
// 幂等键由 onboarding_code + object_version 派生：网络重试不会产生第二次预留
// 或第二个 LDAP 账号，因为目标侧对同一发起方业务键返回既有预留、对同一 uid
// 的 pending operation 返回既有 operation。
const contracts = {
  'identity-reserve': {
    operationCode: 'people.directory.identity-reserve.v1',
    capability: 'console:directory-identity:reserve',
    path: '/api/v1/console/service/directory/onboarding/identity-reservations'
  },
  'identity-release': {
    operationCode: 'people.directory.identity-release.v1',
    capability: 'console:directory-identity:reserve',
    path: '/api/v1/console/service/directory/onboarding/identity-reservation-release'
  },
  'user-provision': {
    operationCode: 'people.directory.user-provision.v1',
    capability: 'console:directory-user:provision',
    path: '/api/v1/console/service/directory/onboarding/user-provision'
  },
  'operation-status': {
    operationCode: 'people.directory.user-provision-status.v1',
    capability: 'console:directory-user:provision',
    path: '/api/v1/console/service/directory/onboarding/operation-status'
  },
  'activation-link': {
    operationCode: 'people.directory.activation-link.v1',
    capability: 'console:directory-user:provision',
    path: '/api/v1/console/service/directory/onboarding/activation-link'
  }
} as const

const text = (value: unknown) => String(value || '').trim()

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Row).sort().map(key => [key, canonical((value as Row)[key])]))
  }
  return value
}

async function sha256Hex(input: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function deterministicOnboardingOperationId(operationCode: string, idempotencyKey: string) {
  const hex = await sha256Hex(`${operationCode}|${idempotencyKey}`)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

// 从 service token claims 与受信转发头推导 tenant / source / target deployment。
//
// 不能用 process.env：托管云 Worker 上 HZY_CONSOLE_TARGET_DEPLOYMENT 往往未设，
// 既有链路也是从 claims 与 Foundation 受信 route helper 取值的。
// trustedServiceRequestHeaders 必须带上目标应用 'console'，否则不会改写
// x-hzy-deployment，目标侧的精确绑定校验会拒绝。
function resolveConsoleCommandBinding(event: H3Event, token: string) {
  const claims = decodeServiceTokenClaims(token)
  const forwarded = trustedServiceRequestHeaders(event, 'console')
  const tenantCode = text(claims.tenant || claims.tenant_code || getHeader(event, 'x-hzy-tenant'))
  const sourceDeployment = text(claims.deployment || claims.deployment_code || getHeader(event, 'x-hzy-deployment'))
  const targetDeployment = text(forwarded['x-hzy-deployment'])
  if (!tenantCode || !sourceDeployment || !targetDeployment) {
    throw createError({
      statusCode: 503,
      message: 'People 到 Console 的 service-command 绑定不完整（缺少 tenant 或 deployment）。'
    })
  }
  return { forwarded, tenantCode, sourceDeployment, targetDeployment }
}

function decodeServiceTokenClaims(token: string): Row {
  try {
    const encoded = token.split('.')[1] || ''
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - encoded.length % 4) % 4)
    const parsed = JSON.parse(atob(normalized))
    return parsed && typeof parsed === 'object' ? parsed as Row : {}
  } catch {
    return {}
  }
}

// describeUpstreamFailure 给跨应用失败标出来源与路径。
//
// 原样透传上游错误会变成一句「Server Error」，看不出是 data-runtime 缺路由、
// Console 缺路由，还是授权被拒——三者的处理方式完全不同。
export function describeUpstreamFailure(target: string, path: string, error: unknown): never {
  const status = Number((error as { statusCode?: number })?.statusCode || 0)
  const detail = String((error as { data?: { message?: string } })?.data?.message
    || (error as { message?: string })?.message || '').trim()
  if (status === 404) {
    throw createError({
      statusCode: 502,
      message: `${target} 没有 ${path} 这个接口，通常是该模块尚未部署到含此接口的版本。`
    })
  }
  throw createError({
    statusCode: status >= 400 && status < 600 ? status : 502,
    message: `调用 ${target} ${path} 失败${detail ? `：${detail}` : ''}`
  })
}

function appendPath(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

// fetchConsoleProvisionOperationStatus 验真建号回执。激活员工之前必须确认
// LDAP 账号确实创建成功——设计明确禁止相信浏览器声称「账号已创建」。
export async function fetchConsoleProvisionOperationStatus(
  event: H3Event,
  input: {
    operationId: string
    onboardingCode: string
    objectVersion: number
    uid: string
    actorUid: string
  }
) {
  return await callConsoleOnboardingProvisioning(event, {
    kind: 'operation-status',
    onboardingCode: input.onboardingCode,
    objectVersion: input.objectVersion,
    uid: input.uid,
    actorUid: input.actorUid,
    command: { provisionOperationId: input.operationId }
  })
}

// fetchConsoleEmploymentLifecycleStatus 读取目录生效情况与 Platform 下一跳
// 状态。Platform 授权操作归 Console 所有，People 不得直接访问 Platform。
export async function fetchConsoleEmploymentLifecycleStatus(
  event: H3Event,
  uid: string
) {
  const baseUrl = resolveServiceAppBaseUrl(event, 'console', { basePath: '/', directTarget: true })
    || resolveConsoleRuntimeBaseUrl(useRuntimeConfig(event), event)
  if (!baseUrl) throw createError({ statusCode: 503, message: 'Console service API base URL is not configured.' })

  return await requestWithServiceAccessToken({
    audience: 'console',
    scope: 'console:directory-employment:sync',
    event,
    async request(token) {
      const binding = resolveConsoleCommandBinding(event, token)
      const path = `/api/v1/console/service/directory/onboarding/employment-status?uid=${encodeURIComponent(uid)}`
      const response = await fetchConsoleServiceJson<{ code?: number | string, message?: string, data?: Row }>(
        event,
        appendPath(baseUrl, path),
        {
          method: 'GET',
          headers: {
            ...binding.forwarded,
            'authorization': `Bearer ${token}`,
            'x-hzy-tenant': binding.tenantCode,
            'x-forwarded-prefix': '/',
            'x-hzy-service-command-target-deployment': binding.targetDeployment
          },
          timeout: 10_000
        }
      )
      if (response.code !== undefined && String(response.code) !== '0') {
        throw createError({ statusCode: 502, message: response.message || 'Console employment status read failed.' })
      }
      return (response.data || {}) as Row
    }
  })
}

// callConsoleSubjectMerge 调用 Console 侧归并。复用入职开通的 capability，
// 不新增授权；隔离性由强制确认理由与结构约束保证。
export async function callConsoleSubjectMerge(
  event: H3Event,
  legacyUid: string,
  canonicalUid: string,
  preview: boolean
) {
  const baseUrl = resolveServiceAppBaseUrl(event, 'console', { basePath: '/', directTarget: true })
    || resolveConsoleRuntimeBaseUrl(useRuntimeConfig(event), event)
  if (!baseUrl) throw createError({ statusCode: 503, message: 'Console service API base URL is not configured.' })

  return await requestWithServiceAccessToken({
    audience: 'console',
    scope: 'console:directory-user:provision',
    event,
    async request(token) {
      const binding = resolveConsoleCommandBinding(event, token)
      const path = preview
        ? `/api/v1/console/service/directory/subject-merge-preview?legacyUid=${encodeURIComponent(legacyUid)}&canonicalUid=${encodeURIComponent(canonicalUid)}`
        : '/api/v1/console/service/directory/subject-merge'
      const response = await fetchConsoleServiceJson<{ code?: number | string, message?: string, data?: Row }>(
        event,
        appendPath(baseUrl, path),
        {
          method: preview ? 'GET' : 'POST',
          headers: {
            ...binding.forwarded,
            'authorization': `Bearer ${token}`,
            'content-type': 'application/json',
            'x-hzy-tenant': binding.tenantCode,
            'x-forwarded-prefix': '/',
            'x-hzy-service-command-target-deployment': binding.targetDeployment
          },
          body: preview ? undefined : { legacyUid, canonicalUid },
          timeout: 20_000
        }
      )
      if (response.code !== undefined && String(response.code) !== '0') {
        throw createError({ statusCode: 502, message: response.message || 'Console subject merge failed.' })
      }
      return (response.data || {}) as Row
    }
  })
}

export interface OnboardingProvisioningInput {
  kind: OnboardingProvisioningKind
  onboardingCode: string
  objectVersion: number
  uid: string
  actorUid: string
  command?: Row
}

// callConsoleOnboardingProvisioning 构造签名命令并调用 Console Service API。
// actor 必须来自已验证的用户会话：高价值操作不接受浏览器 header 传入的身份。
export async function callConsoleOnboardingProvisioning(
  event: H3Event,
  input: OnboardingProvisioningInput
) {
  const contract = contracts[input.kind]
  const actorUid = text(input.actorUid)
  if (!actorUid) throw createError({ statusCode: 403, message: '需要已验证的操作人身份。' })
  const onboardingCode = text(input.onboardingCode)
  const uid = text(input.uid)
  if (!onboardingCode || !uid) throw createError({ statusCode: 400, message: '入职单编码与 UID 不能为空。' })
  if (!(Number(input.objectVersion) > 0)) {
    throw createError({ statusCode: 400, message: '入职单版本不合法。' })
  }
  if (uid.toLowerCase().startsWith('dt-')) {
    throw createError({ statusCode: 400, message: '合成的 dt-* 标识不能作为 canonical UID 开通。' })
  }

  const baseUrl = resolveServiceAppBaseUrl(event, 'console', { basePath: '/', directTarget: true })
    || resolveConsoleRuntimeBaseUrl(useRuntimeConfig(event), event)
  if (!baseUrl) throw createError({ statusCode: 503, message: 'Console service API base URL is not configured.' })

  const command: Row = {
    ...(input.command || {}),
    onboardingCode,
    sourceApp: 'people',
    sourceBizCode: onboardingCode,
    uid,
    objectVersion: Number(input.objectVersion),
    actorUid,
    originalActorUid: actorUid
  }
  const commandSha256 = await sha256Hex(JSON.stringify(canonical(command)))
  // 幂等键绑定入职单与其版本：同一版本的重试是同一次业务意图，
  // 资料改动会产生新版本和新的键，不会复用上一次的冻结命令。
  const idempotencyKey = `onboarding:${input.kind}:${onboardingCode}:v${input.objectVersion}`
  const operationId = await deterministicOnboardingOperationId(contract.operationCode, idempotencyKey)

  return await requestWithServiceAccessToken({
    audience: 'console',
    scope: contract.capability,
    event,
    async request(token) {
      const binding = resolveConsoleCommandBinding(event, token)
      const timestamp = String(Math.floor(Date.now() / 1000))
      const message = `POST\n${contract.path}\n${binding.tenantCode}\n${binding.sourceDeployment}\n${binding.targetDeployment}\npeople\nconsole\n${operationId}\n${contract.operationCode}\n${contract.capability}\n${idempotencyKey}\nv1\n${commandSha256}\n${actorUid}\n${timestamp}`
      const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(token), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
      const signature = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)))]
        .map(byte => byte.toString(16).padStart(2, '0')).join('')

      const response = await fetchConsoleServiceJson<{ code?: number | string, message?: string, data?: unknown }>(
        event,
        appendPath(baseUrl, contract.path),
        {
          method: 'POST',
          headers: {
            ...binding.forwarded,
            'authorization': `Bearer ${token}`,
            'content-type': 'application/json',
            'idempotency-key': idempotencyKey,
            'x-hzy-tenant': binding.tenantCode,
            'x-forwarded-prefix': '/',
            'x-hzy-service-command-source-deployment': binding.sourceDeployment,
            'x-hzy-service-command-target-deployment': binding.targetDeployment,
            'x-hzy-service-command-timestamp': timestamp,
            'x-hzy-service-command-signature': signature
          },
          body: {
            serviceCommand: {
              operationId,
              operationCode: contract.operationCode,
              requiredCapability: contract.capability,
              idempotencyKey,
              commandSchemaVersion: 'v1',
              commandSha256,
              sourceApp: 'people',
              targetApp: 'console',
              sourceDeployment: binding.sourceDeployment,
              targetDeployment: binding.targetDeployment,
              command
            }
          },
          timeout: 15_000
        }
      )
      if (response.code !== undefined && String(response.code) !== '0') {
        throw createError({ statusCode: 502, message: response.message || 'Console onboarding provisioning command failed.' })
      }
      return response.data as Row
    }
  })
}
