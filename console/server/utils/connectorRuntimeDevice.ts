import type { H3Event } from 'h3'
import {
  recordConsoleConnectorRuntimeHeartbeat,
  revokeConsoleConnectorRuntime
} from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import type { VaultActor } from './vault'

export async function recordConnectorRuntimeHeartbeat(
  event: H3Event,
  actor: VaultActor,
  input: Record<string, unknown>
) {
  if (actor.actorType !== 'service' || !actor.actorId) {
    throw createError({ statusCode: 403, message: 'Connector Runtime service identity is required' })
  }
  const response = await recordConsoleConnectorRuntimeHeartbeat(event, {
    ...input,
    verifiedClientCode: actor.actorId
  })
  return response.data
}

export async function revokeConnectorRuntime(event: H3Event) {
  const response = await revokeConsoleConnectorRuntime(event)
  return response.data
}
