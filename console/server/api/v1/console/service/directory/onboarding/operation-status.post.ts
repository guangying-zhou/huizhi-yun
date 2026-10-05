import { readBody } from 'h3'
import { getConsoleDirectoryConnectorOperationForServiceCommand } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import {
  resolvePeopleDirectoryTargetBinding,
  verifyPeopleDirectorySignature
} from '~~/server/utils/directoryLifecycleReliable'
import { parseOnboardingProvisioningCommand } from '~~/server/utils/onboardingProvisioningContract'
import { requireConsoleServiceActor } from '~~/server/utils/vault'

// People 验真建号回执。读取也使用完整 service-command actor 委托，避免把最初
// 发起开通的 HR 固化成唯一可恢复人；目标 runtime 另外按 UID 绑定 operation。
export default defineEventHandler(async (event) => {
  const actor = await requireConsoleServiceActor(event, 'console', 'console:directory-user:provision', {
    requireBoundTargetApp: true
  })
  const binding = resolvePeopleDirectoryTargetBinding(event, actor.tenantCode)
  const body = await readBody<Record<string, unknown>>(event).catch(() => ({} as Record<string, unknown>))
  verifyPeopleDirectorySignature(event, body, binding)
  const { command, uid } = parseOnboardingProvisioningCommand(body, 'operation-status')
  const operationId = String(command.provisionOperationId || '').trim()

  const runtime = await getConsoleDirectoryConnectorOperationForServiceCommand(
    event,
    operationId,
    body,
    String(command.actorUid || '').trim()
  )
  const data = (runtime.data || {}) as Record<string, unknown>
  if (String(data.uid || '') !== uid) {
    throw createError({ statusCode: 409, message: 'Provision operation does not belong to this onboarding UID.' })
  }
  return {
    code: 0,
    message: 'ok',
    data: {
      operationId,
      status: String(data.status || ''),
      attemptCount: Number(data.attemptCount || 0),
      errorCode: String(data.errorCode || '') || null
    }
  }
})
