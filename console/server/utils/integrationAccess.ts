import type { H3Event } from 'h3'
import { requirePermission } from '~~/server/utils/checkPermission'
import { requireConsoleRequestUid } from '~~/server/utils/requestIdentity'
import { requireConsoleServiceActor, type VaultActor } from '~~/server/utils/vault'

type IntegrationAction = 'view' | 'edit'

export async function requireIntegrationAccess(event: H3Event, action: IntegrationAction): Promise<VaultActor> {
  try {
    await requirePermission(event, 'integration_config', action)
    const uid = await requireConsoleRequestUid(event)
    return {
      actorType: 'human',
      actorId: uid,
      appCode: 'console'
    }
  } catch (error) {
    if (action !== 'view') {
      throw error
    }
    return await requireConsoleServiceActor(event, 'integration_config', 'integration_config:view')
  }
}
