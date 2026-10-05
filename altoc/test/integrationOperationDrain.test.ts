import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const taskPath = `${root}/server/tasks/integration-operations/drain.ts`
const drainPath = `${root}/server/utils/integrationOperationDrain.ts`
const wakePath = `${root}/server/api/internal/integration-operations/drain.post.ts`

function requiredSource(path: string, message: string) {
  assert.ok(existsSync(path), message)
  return readFileSync(path, 'utf8')
}

test('Altoc Cloudflare declares a bounded integration-operation drain task and bound opt-in cron', () => {
  const task = requiredSource(taskPath, 'Altoc integration-operation drain task is required')
  const render = readFileSync(`${root}/scripts/render-cloudflare-config.mjs`, 'utf8')
  const nuxtConfig = readFileSync(`${root}/nuxt.config.ts`, 'utf8')

  assert.match(task, /defineTask\s*\(/)
  assert.match(task, /name:\s*['"]integration-operations:drain['"]/)
  assert.match(task, /drainIntegrationOperations/)
  assert.match(task, /maxClaims\s*:\s*[1-9][0-9]*/)
  assert.match(task, /maxWallTimeMs\s*:\s*[1-9][0-9]*/)
  assert.match(render, /crons\s*:/)
  assert.match(render, /\*\/[1-9][0-9]*\s+\*\s+\*\s+\*\s+\*/)
  assert.match(render, /HZY_ALTOC_SCHEDULED_DRAIN_ENABLED/)
  assert.match(render, /HZY_TENANT_RUNTIME_TENANT/)
  assert.match(render, /HZY_TENANT_RUNTIME_DEPLOYMENT/)
  assert.match(nuxtConfig, /scheduledTasks/)
  assert.match(nuxtConfig, /integration-operations:drain/)

  const deploymentContract = `${task}\n${render}`.toLowerCase()
  assert.doesNotMatch(deploymentContract, /gitlab-runner|\.gitlab-ci|gitlab pipeline/)
})

test('Altoc drain loops safely over frozen commands and always checkpoints', () => {
  const drain = requiredSource(drainPath, 'Altoc integrationOperationDrain utility is required')
  const executor = requiredSource(`${root}/server/utils/serviceTicketOpsKnowledgeOperation.ts`, 'Altoc shared request/scheduled executor is required')

  assert.match(drain, /export async function drainIntegrationOperations/)
  assert.match(drain, /maxClaims/)
  assert.match(drain, /maxWallTimeMs/)
  assert.match(drain, /Date\.now\(\)/)
  assert.match(drain, /for\s*\(|while\s*\(/)
  assert.match(drain, /integration-operations:claim-next/)
  assert.match(drain, /altoc\.write altoc:integration_operation:execute/)
  assert.match(drain, /if\s*\([^)]*!\s*(?:claimed|operation)|if\s*\([^)]*(?:claimed|operation)\s*==\s*null/)
  assert.match(drain, /break/)
  assert.match(drain, /executeClaimedOpsKnowledgeOperation/)
  assert.match(executor, /operation\.command/)
  assert.match(executor, /createRequestOpsKnowledgeOperationIO/)
  assert.match(executor, /createScheduledOpsKnowledgeOperationIO/)
  assert.match(executor, /:succeed/)
  assert.match(executor, /:fail/)
  assert.match(drain, /continue/)

  assert.doesNotMatch(drain, /callAimsScheduledRuntime\([^)]*integration-operations:claim-next/)
  assert.doesNotMatch(drain, /(?:payload|command)\s*(?:\.|\[['"])(?:url|token|tenantCode|tenant_code|deploymentCode|deployment_code)/i)
  assert.doesNotMatch(drain.toLowerCase(), /gitlab-runner|\.gitlab-ci/)
  assert.doesNotMatch(executor, /x-hzy-(?:tenant|data)-runtime-(?:url|token)/)
})

test('Altoc shared wake is private, signed and event-bound', () => {
  const wake = requiredSource(wakePath, 'Altoc private scheduler wake endpoint is required')
  const drain = requiredSource(drainPath, 'Altoc event-bound drain is required')
  const guard = requiredSource(`${root}/server/middleware/internal-task-guard.ts`, 'Altoc Nitro task HTTP guard is required')
  assert.match(wake, /requireTenantGatewaySchedulerRequest\(event, 'altoc'\)/)
  assert.match(wake, /drainIntegrationOperationsForEvent\(event, binding/)
  assert.match(wake, /maxClaims:\s*10/)
  assert.match(wake, /maxWallTimeMs:\s*25_000/)
  assert.match(drain, /createRequestOpsKnowledgeOperationIO\(event, \{\}\)/)
  assert.match(guard, /_nitro\\\/tasks/)
  assert.doesNotMatch(wake, /readBody|getQuery|authorization|cookie/i)
})
