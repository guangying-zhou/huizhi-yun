import { readBody } from 'h3'
import { reserveConsoleDirectoryIdentity } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import {
  resolvePeopleDirectoryTargetBinding,
  verifyPeopleDirectorySignature
} from '~~/server/utils/directoryLifecycleReliable'
import { parseOnboardingProvisioningCommand } from '~~/server/utils/onboardingProvisioningContract'
import { requireConsoleServiceActor } from '~~/server/utils/vault'

// People 受控入职的身份预留入口。开户前先原子占位 UID/登录名/邮箱/外部主体。
export default defineEventHandler(async (event) => {
  const actor = await requireConsoleServiceActor(event, 'console', 'console:directory-identity:reserve', {
    requireBoundTargetApp: true
  })
  const actorId = String(actor.actorId || '').trim()
  if (!actorId) throw createError({ statusCode: 403, message: 'People service actor identity is required.' })

  const binding = resolvePeopleDirectoryTargetBinding(event, actor.tenantCode)
  const body = await readBody<Record<string, unknown>>(event).catch(() => ({} as Record<string, unknown>))
  verifyPeopleDirectorySignature(event, body, binding)
  const { command, uid, onboardingCode } = parseOnboardingProvisioningCommand(body, 'identity-reserve')

  const runtime = await reserveConsoleDirectoryIdentity(event, {
    uid,
    username: command.username,
    email: command.email,
    providerCode: command.providerCode,
    providerSubject: command.providerSubject,
    sourceApp: 'people',
    // 以入职单编码作为发起方业务键：同一入职单重复请求返回既有预留，
    // 网络重试不会占用第二个 UID。
    sourceBizCode: onboardingCode
  }, {
    body,
    actorUid: String(command.actorUid || '').trim()
  })
  return { code: 0, message: 'ok', data: runtime.data }
})
