import { readBody, setResponseStatus } from 'h3'
import { queueConsoleDirectoryLDAPUserCreate } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import {
  resolvePeopleDirectoryTargetBinding,
  verifyPeopleDirectorySignature
} from '~~/server/utils/directoryLifecycleReliable'
import { parseOnboardingProvisioningCommand } from '~~/server/utils/onboardingProvisioningContract'
import { requireConsoleServiceActor } from '~~/server/utils/vault'

// People 受控入职的 LDAP 开户入口。
//
// 初始口令由 Console 生成，是谁都不知道也不留存的一次性抛弃值。这里只排队
// LDAP 开户；确认 Connector 成功写入 LDAP 后，People 才会调用独立激活入口，
// 由 Console 将一次性链接直接投递给员工本人。People 全程不接收明文凭据。
export default defineEventHandler(async (event) => {
  const actor = await requireConsoleServiceActor(event, 'console', 'console:directory-user:provision', {
    requireBoundTargetApp: true
  })
  const actorId = String(actor.actorId || '').trim()
  if (!actorId) throw createError({ statusCode: 403, message: 'People service actor identity is required.' })

  const binding = resolvePeopleDirectoryTargetBinding(event, actor.tenantCode)
  const body = await readBody<Record<string, unknown>>(event).catch(() => ({} as Record<string, unknown>))
  verifyPeopleDirectorySignature(event, body, binding)
  const { command, uid } = parseOnboardingProvisioningCommand(body, 'user-provision')

  const runtime = await queueConsoleDirectoryLDAPUserCreate(event, {
    reservationId: command.reservationId,
    sourceBizCode: command.onboardingCode,
    uid,
    username: command.username,
    displayName: command.displayName,
    realName: command.displayName,
    email: command.email,
    mobile: command.mobile,
    positionTitle: command.positionName,
    primaryDeptCode: command.deptCode,
    userType: 'employee',
    status: 'active',
    sourceApp: 'people',
    providerCode: command.providerCode,
    providerSubject: command.providerSubject,
    issueActivationCredential: false
  }, {
    body,
    actorUid: String(command.actorUid || '').trim()
  })

  const data = (runtime as { data?: Record<string, unknown> }).data || {}
  setResponseStatus(event, 202)
  return { code: 0, message: 'ok', data: { ...data, activationDelivered: false } }
})
