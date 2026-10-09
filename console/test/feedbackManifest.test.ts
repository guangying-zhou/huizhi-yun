import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { feedbackOperations, feedbackPermission } from '@hzy/foundation/server/utils/feedbackPermit'

test('feedback operation permissions and role defaults come from Console manifest', () => {
  const manifest = JSON.parse(readFileSync(new URL('../app.manifest.json', import.meta.url), 'utf8'))
  const resources = new Map<string, string[]>(manifest.resources.map((r: { code: string, actions: string[] }) => [r.code, r.actions]))
  for (const op of feedbackOperations) {
    const p = feedbackPermission(op)
    assert.ok(resources.get(p.resource)?.includes(p.action), op)
  }
  const reporter = manifest.recommendedRoles.find((r: { code: string }) => r.code === 'console:feedback_reporter')
  assert.deepEqual(reporter.defaultScopes, ['subject:self'])
  assert.deepEqual(reporter.suggestedPermissions, ['console:feedback:view', 'console:feedback:submit'])
  const manager = manifest.recommendedRoles.find((r: { code: string }) => r.code === 'console:feedback_manager')
  assert.deepEqual(manager.defaultScopes, ['tenant:global'])
  assert.ok(manager.suggestedPermissions.includes('console:feedback:retry'))
  for (const role of manifest.recommendedRoles) assert.ok(!role.suggestedPermissions.includes('console:feedback-delivery:execute'))
})
