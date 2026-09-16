import { readBody, setHeader } from 'h3'
import { ok } from '~~/server/utils/directoryRuntime'
import { recordConnectorRuntimeHeartbeat } from '~~/server/utils/connectorRuntimeDevice'
import { requireConsoleServiceActor } from '~~/server/utils/vault'

export default defineEventHandler(async (event) => {
  const actor = await requireConsoleServiceActor(
    event,
    'console',
    'console:connector-runtime:heartbeat',
    { requireBoundTargetApp: true }
  )
  const body = await readBody(event)
  setHeader(event, 'Cache-Control', 'no-store')
  return ok(await recordConnectorRuntimeHeartbeat(event, actor, body))
})
