import type { H3Event } from 'h3'
import { requirePermission } from '~~/server/utils/checkPermission'
import { requireConsoleRequestUid } from '~~/server/utils/requestIdentity'
import { requireConsoleServiceActor, type VaultActor } from '~~/server/utils/vault'

type SystemSettingsAction = 'view' | 'edit'

export async function requireSystemSettingsAccess(event: H3Event, action: SystemSettingsAction): Promise<VaultActor> {
  try {
    await requirePermission(event, 'system_settings', action)
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
    return await requireConsoleServiceActor(event, 'system_settings', 'system_settings:view')
  }
}
