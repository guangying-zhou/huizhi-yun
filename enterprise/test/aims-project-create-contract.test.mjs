import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('project create binds the proposed code and department to its own scoped grant', () => {
  const bff = read('server/utils/enterpriseAimsProjectCreate.ts')
  assert.match(bff, /Idempotency-Key/)
  assert.match(bff, /loadProjectCommandAuthorization\(event, user/)
  assert.match(bff, /resource: 'projects', action: 'create'/)
  assert.match(bff, /projectCode, deptCode/)
  assert.match(bff, /aims\.project-create/)
  assert.doesNotMatch(bff, /authorization:\s*\{[^}]*allowed:\s*true/s)
})

test('project create checks scope before receipt and retains atomic domain write', () => {
  const command = read('../data-runtime/internal/apps/aims/enterprise_project_create.go')
  const domain = read('../data-runtime/internal/apps/aims/product_versions.go')
  assert.ok(command.indexOf('requireEnterpriseProjectCreateScopeTx(identity, command)') < command.indexOf('repository.ExecuteInTransaction'))
  assert.match(command, /createProjectWithProductBindingTx\(ctx, tx/)
  assert.match(command, /tx\.Commit\(\)/)
  assert.match(domain, /INSERT INTO project_lifecycle_events/)
})

test('new project layer does not expose member, plan or board writes', () => {
  const page = read('../aims/layer/pages/enterprise-project-new.vue')
  assert.match(page, /Idempotency-Key/)
  assert.doesNotMatch(page, /(?:members|milestones|board|work-items)/)
})
