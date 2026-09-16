import { getHeader, type H3Event } from 'h3'
import { verifyActiveServiceAccessToken } from '~~/server/utils/oidc'
import {
  authorizeConsoleServiceActor,
  consoleServiceActorContext
} from '~~/server/utils/consoleServiceActor'

export interface VaultActor {
  actorType: 'human' | 'service' | 'system'
  actorId: string | null
  appCode?: string | null
  tenantCode?: string | null
  deploymentCode?: string | null
}

function stringValue(value: unknown) {
  return String(value || '').trim()
}

export async function requireConsoleServiceActor(
  event: H3Event,
  audience: string,
  requiredScope: string,
  options: { requireBoundTargetApp?: boolean } = {}
): Promise<VaultActor> {
  const actor = await authorizeConsoleServiceActor({
    authorization: stringValue(getHeader(event, 'authorization')),
    audience,
    requiredScope,
    requireBoundTargetApp: options.requireBoundTargetApp,
    verify: async (token, expectedAudience) => await verifyActiveServiceAccessToken(
      event,
      token,
      { audience: expectedAudience }
    )
  })
  event.context.consoleAuth = consoleServiceActorContext(
    actor,
    requiredScope,
    event.context.consoleAuth as Record<string, unknown> | undefined
  )
  return actor
}

export async function requireVaultServiceActor(
  event: H3Event,
  requiredScope = 'credential_vault:resolve'
): Promise<VaultActor> {
  return await requireConsoleServiceActor(event, 'credential_vault', requiredScope)
}
