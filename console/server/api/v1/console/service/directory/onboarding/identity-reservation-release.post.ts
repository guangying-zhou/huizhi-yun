import { readBody } from 'h3'
import { releaseConsoleDirectoryIdentityReservationForServiceCommand } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import {
  resolvePeopleDirectoryTargetBinding,
  verifyPeopleDirectorySignature
} from '~~/server/utils/directoryLifecycleReliable'
import { parseOnboardingProvisioningCommand } from '~~/server/utils/onboardingProvisioningContract'
import { requireConsoleServiceActor } from '~~/server/utils/vault'

export default defineEventHandler(async (event) => {
  const actor = await requireConsoleServiceActor(event, 'console', 'console:directory-identity:reserve', {
    requireBoundTargetApp: true
  })
  const binding = resolvePeopleDirectoryTargetBinding(event, actor.tenantCode)
  const body = await readBody<Record<string, unknown>>(event).catch(() => ({} as Record<string, unknown>))
  verifyPeopleDirectorySignature(event, body, binding)
  const { command } = parseOnboardingProvisioningCommand(body, 'identity-release')
  const runtime = await releaseConsoleDirectoryIdentityReservationForServiceCommand(
    event,
    body,
    String(command.actorUid || '').trim()
  )
  return { code: 0, message: 'ok', data: runtime.data || {} }
})
