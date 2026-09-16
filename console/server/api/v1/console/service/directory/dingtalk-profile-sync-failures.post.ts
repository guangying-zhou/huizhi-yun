import { createHash } from 'node:crypto'
import { getHeader, readBody } from 'h3'
import { applyConsoleDingTalkDirectoryProfileCommand } from '@hzy/foundation/server/utils/consoleTenantRuntimeClient'
import { ok } from '~~/server/utils/directoryRuntime'
import { deterministicServiceCommandOperationId } from '~~/server/utils/deterministicServiceCommandOperationId'
import { requireConsoleServiceActor } from '~~/server/utils/vault'

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    const input = value as Record<string, unknown>
    return Object.fromEntries(Object.keys(input).sort().map(key => [key, canonical(input[key])]))
  }
  return value
}

export default defineEventHandler(async (event) => {
  await requireConsoleServiceActor(
    event,
    'console',
    'console:directory-profiles:sync',
    { requireBoundTargetApp: true }
  )
  const command = await readBody<Record<string, unknown>>(event)
  const idempotencyKey = String(getHeader(event, 'idempotency-key') || '').trim()
  const commandSha256 = createHash('sha256').update(JSON.stringify(canonical(command))).digest('hex')
  const result = await applyConsoleDingTalkDirectoryProfileCommand(event, 'failure', {
    serviceCommand: {
      operationId: deterministicServiceCommandOperationId('dingtalk-profile', idempotencyKey),
      targetApp: 'console',
      operationCode: 'connector-runtime.console.dingtalk-directory-profile-sync.v1',
      requiredCapability: 'console:directory-profiles:sync',
      idempotencyKey,
      commandSchemaVersion: 'v1',
      commandSha256,
      command
    }
  })
  return ok(result.data)
})
