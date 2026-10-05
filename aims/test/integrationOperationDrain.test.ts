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

test('Aims Cloudflare declares a bounded integration-operation drain task and bound opt-in cron', () => {
  const task = requiredSource(taskPath, 'Aims integration-operation drain task is required')
  const drain = requiredSource(drainPath, 'Aims integrationOperationDrain utility is required')
  const render = readFileSync(`${root}/scripts/render-cloudflare-config.mjs`, 'utf8')
  const nuxtConfig = readFileSync(`${root}/nuxt.config.ts`, 'utf8')

  assert.match(task, /defineTask\s*\(/)
  assert.match(task, /name:\s*['"]integration-operations:drain['"]/)
  assert.match(task, /drainIntegrationOperations/)
  assert.match(task, /maxClaims\s*:\s*[1-9][0-9]*/)
  assert.match(task, /maxWallTimeMs\s*:\s*[1-9][0-9]*/)
  assert.match(render, /crons\s*:/)
  assert.match(render, /\*\/[1-9][0-9]*\s+\*\s+\*\s+\*\s+\*/)
  assert.match(render, /HZY_AIMS_SCHEDULED_DRAIN_ENABLED/)
  assert.match(render, /HZY_TENANT_RUNTIME_TENANT/)
  assert.match(render, /HZY_TENANT_RUNTIME_DEPLOYMENT/)
  assert.match(render, /HZY_CODOCS_TARGET_DEPLOYMENT/)
  assert.match(drain, /codocs:\s*binding\.codocsTargetDeployment/)
  assert.match(nuxtConfig, /scheduledTasks/)
  assert.match(nuxtConfig, /integration-operations:drain/)

  const deploymentContract = `${task}\n${render}`.toLowerCase()
  assert.doesNotMatch(deploymentContract, /gitlab-runner|\.gitlab-ci|gitlab pipeline/)
})

test('Aims drain loops safely over frozen commands and always checkpoints', () => {
  const drain = requiredSource(drainPath, 'Aims integrationOperationDrain utility is required')
  const executor = [
    requiredSource(`${root}/server/utils/serviceTicketDeliveryOperation.ts`, 'Aims shared request/scheduled IO is required'),
    requiredSource(`${root}/server/utils/serviceTicketDeliveryOperationExecutor.ts`, 'Aims frozen command executor is required')
  ].join('\n')

  assert.match(drain, /export async function drainIntegrationOperations/)
  assert.match(drain, /maxClaims/)
  assert.match(drain, /maxWallTimeMs/)
  assert.match(drain, /Date\.now\(\)/)
  assert.match(drain, /for\s*\(|while\s*\(/)
  assert.match(drain, /integration-operations:claim-next/)
  assert.match(drain, /aims\.write aims:integration_operation:execute/)
  assert.match(drain, /if\s*\([^)]*!\s*(?:claimed|operation)|if\s*\([^)]*(?:claimed|operation)\s*==\s*null/)
  assert.match(drain, /break/)
  assert.match(drain, /executeClaimedAimsOperation/)
  assert.match(requiredSource(`${root}/server/utils/claimedAimsOperationExecutor.ts`, 'Aims operation dispatcher is required'), /executeClaimedServiceTicketDeliveryOperation/)
  assert.match(requiredSource(`${root}/server/utils/claimedAimsOperationExecutor.ts`, 'Aims operation dispatcher is required'), /executeClaimedMilestoneReceivableOperation/)
  assert.match(executor, /operation\.command/)
  assert.match(executor, /createRequestServiceTicketDeliveryOperationIO/)
  assert.match(executor, /createScheduledServiceTicketDeliveryOperationIO/)
  assert.match(executor, /:succeed/)
  assert.match(executor, /:fail/)
  assert.match(drain, /continue/)

  assert.doesNotMatch(drain, /callAltocScheduledRuntime\([^)]*integration-operations:claim-next/)
  assert.doesNotMatch(drain, /(?:payload|command)\s*(?:\.|\[['"])(?:url|token|tenantCode|tenant_code|deploymentCode|deployment_code)/i)
  assert.doesNotMatch(drain.toLowerCase(), /gitlab-runner|\.gitlab-ci/)
  assert.doesNotMatch(executor, /x-hzy-(?:tenant|data)-runtime-(?:url|token)/)
})

test('Aims shared wake is private, signed and event-bound', () => {
  const wake = requiredSource(wakePath, 'Aims private scheduler wake endpoint is required')
  const drain = requiredSource(drainPath, 'Aims event-bound drain is required')
  const guard = requiredSource(`${root}/server/middleware/internal-task-guard.ts`, 'Aims Nitro task HTTP guard is required')
  assert.match(wake, /requireTenantGatewaySchedulerRequest\(event, 'aims'\)/)
  assert.match(wake, /drainIntegrationOperationsForEvent\(event, binding/)
  assert.match(wake, /maxClaims:\s*10/)
  assert.match(wake, /maxWallTimeMs:\s*25_000/)
  assert.match(drain, /createRequestServiceTicketDeliveryOperationIO\(event\)/)
  assert.match(guard, /_nitro\\\/tasks/)
  assert.doesNotMatch(wake, /readBody|getQuery|authorization|cookie/i)
})
