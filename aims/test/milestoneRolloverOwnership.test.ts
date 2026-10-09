import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { isInProcessMilestoneRolloverOwner, isUnifiedMilestoneRolloverOwner } from '../server/utils/milestoneRolloverOwner.ts'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const runtime = (path: string) => readFileSync(new URL(`../../data-runtime/${path}`, import.meta.url), 'utf8')

test('unified milestone rollover runs only from the signed scheduler wake with its exact capability', () => {
  const drain = read('server/utils/integrationOperationDrain.ts')
  const scheduled = read('server/utils/scheduledRuntime.ts')
  // The call sits after the drain and only on unified/recovered storage.
  const unifiedBranch = drain.slice(drain.indexOf('export async function drainIntegrationOperationsForEvent'))
  assert.match(unifiedBranch, /if \(!unified\) return result[\s\S]*callAimsUnifiedMilestoneRollover<[^\n]*\(event, verified\.schedulerGeneration\)/)
  // A rollover failure is isolated from the already checkpointed drain result.
  assert.match(unifiedBranch, /catch \(error\)[\s\S]*milestoneRollover = \{ failed: true \}/)
  // Due notifications ride the same wake with their own generation-bound caller.
  assert.match(unifiedBranch, /drainAimsDueNotifications\(\{[\s\S]*runtime: \(path, body\) => callAimsUnifiedDueNotification\(event, path, body, verified\.schedulerGeneration\)/)
  assert.match(unifiedBranch, /catch \(error\)[\s\S]*dueNotifications = \{ failed: true \}/)
  assert.match(unifiedBranch, /return \{ \.\.\.result, milestoneRollover, dueNotifications \}/)
  // Calls go through the signed wake's event-bound Runtime transport, never static Worker config.
  const unifiedRuntime = read('server/utils/unifiedSchedulerRuntime.ts')
  assert.doesNotMatch(scheduled, /callAimsUnified(MilestoneRollover|DueNotification)/)
  const start = unifiedRuntime.indexOf('export async function callAimsUnifiedMilestoneRollover')
  const helper = unifiedRuntime.slice(start, unifiedRuntime.indexOf('\n}\n', start))
  assert.match(helper, /'\/v1\/enterprise\/aims\/milestones:rollover-due'/)
  assert.match(helper, /'aims:milestone-rollover:execute'/)
  assert.match(unifiedRuntime, /enterpriseScheduler: \{ generation \}/)
  assert.match(unifiedRuntime, /maybeCallTenantRuntime</)
  assert.match(helper, /generation, \{\}\)/)
  assert.doesNotMatch(helper, /aims\.write/)
})

test('the local rollover cron treats only the Runtime owner refusal as skipped', () => {
  const task = read('server/tasks/milestones/rollover.ts')
  assert.match(task, /isUnifiedMilestoneRolloverOwner\(err\)[\s\S]*skipped: 'unified_scheduler_owner'[\s\S]*throw err/)
  assert.equal(isUnifiedMilestoneRolloverOwner({ statusCode: 409, data: { error: { code: 'aims_milestone_rollover_unified_owner' } } }), true)
  assert.equal(isUnifiedMilestoneRolloverOwner({ statusCode: 409, data: { error: { code: 'enterprise_scheduler_generation_stale' } } }), false)
  assert.equal(isUnifiedMilestoneRolloverOwner({ statusCode: 403, data: { error: { code: 'aims_milestone_rollover_unified_owner' } } }), false)
  assert.equal(isUnifiedMilestoneRolloverOwner({ statusCode: 409, data: { code: 'aims_milestone_rollover_unified_owner' } }), false)
  assert.equal(isUnifiedMilestoneRolloverOwner(new Error('network')), false)
  assert.equal(isUnifiedMilestoneRolloverOwner(null), false)
})

test('the signed-wake drain skips only the in-process owner refusal in the tenantRuntimeClient error shape', () => {
  const drain = read('server/utils/integrationOperationDrain.ts')
  assert.match(drain, /isInProcessMilestoneRolloverOwner\(error\)[\s\S]*skipped: 'runtime_scheduler_owner'[\s\S]*failed: true/)
  // Foundation tenantRuntimeClient rethrows as { statusCode, data: { code, message, upstreamStatus } }.
  assert.equal(isInProcessMilestoneRolloverOwner({ statusCode: 409, data: { code: 'aims_milestone_rollover_inprocess_owner', upstreamStatus: 409 } }), true)
  assert.equal(isInProcessMilestoneRolloverOwner({ statusCode: 409, data: { code: 'enterprise_scheduler_generation_stale', upstreamStatus: 409 } }), false)
  assert.equal(isInProcessMilestoneRolloverOwner({ statusCode: 503, data: { code: 'aims_milestone_rollover_inprocess_owner', upstreamStatus: 409 } }), false)
  assert.equal(isInProcessMilestoneRolloverOwner({ statusCode: 409, data: { code: 'aims_milestone_rollover_inprocess_owner', upstreamStatus: 502 } }), false)
  assert.equal(isInProcessMilestoneRolloverOwner({ statusCode: 409, data: { error: { code: 'aims_milestone_rollover_inprocess_owner' } } }), false)
  assert.equal(isInProcessMilestoneRolloverOwner(new Error('network')), false)
  assert.equal(isInProcessMilestoneRolloverOwner(null), false)
})

test('Runtime refuses the legacy rollover entry once the unified scheduler owns it', () => {
  const server = runtime('internal/server/server.go')
  const route = runtime('internal/server/enterprise_scheduler_rollover.go')
  assert.match(route, /legacyMilestoneRolloverPath\s+= "\/v1\/aims\/service\/milestones:rollover-due"/)
  assert.match(server, /legacyMilestoneRolloverOwnedByUnified\(path[\s\S]{0,300}"aims_milestone_rollover_unified_owner"[\s\S]{0,300}if isAimsRuntimePath\(path\)/)
  assert.match(route, /authenticateEnterpriseSchedulerCapability\([^)]*enterpriseMilestoneRolloverCapability\)/)
})

test('in-process owner is skipped by the legacy cron envelope, not unrelated failures', () => {
  assert.equal(isUnifiedMilestoneRolloverOwner({ statusCode: 409, data: { error: { code: 'aims_milestone_rollover_inprocess_owner' } } }), true)
  assert.equal(isUnifiedMilestoneRolloverOwner({ statusCode: 403, data: { error: { code: 'aims_milestone_rollover_inprocess_owner' } } }), false)
  assert.equal(isUnifiedMilestoneRolloverOwner({ statusCode: 409, data: { error: { code: 'aims_milestone_rollover_inprocess_owner_other' } } }), false)
})
