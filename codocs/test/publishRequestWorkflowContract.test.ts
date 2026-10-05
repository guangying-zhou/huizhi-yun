import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = resolve(import.meta.dirname, '..')
const read = (file: string) => readFileSync(resolve(root, file), 'utf8')

test('publish request Workflow binding only uses the trusted runtime command and receipt checkpoint', () => {
  const route = read('server/api/reviews/publish-requests/[id]/workflow-instance.post.ts')
  assert.match(route, /workflow-command/)
  assert.match(route, /workflow:document-publish:create/)
  assert.match(route, /buildServiceCommandEnvelope/)
  assert.match(route, /validateServiceCommandReceipt/)
  assert.match(route, /workflow-checkpoint/)
  assert.match(route, /instance\.instance_id/)
  assert.doesNotMatch(route, /instance\.id/)
  assert.doesNotMatch(route, /readBody\(/)
})

test('Workflow callback is a source-bound service-only state projection', () => {
  const callback = read('server/api/reviews/workflow-callback.post.ts')
  assert.match(callback, /WORKFLOW_PUBLISH_REQUEST_CALLBACK_SERVICE_AUTH/)
  assert.match(callback, /requireCodocsServiceTenantDeploymentBinding/)
  assert.match(callback, /getHeader\(event, 'x-hzy-tenant'\)/)
  assert.match(callback, /getHeader\(event, 'x-hzy-deployment'\)/)
  assert.match(callback, /workflow-callback/)
  assert.match(callback, /body\.app_code !== 'codocs'/)
  assert.match(callback, /body\.resource_code !== 'documents'/)
  assert.doesNotMatch(callback, /current_user/)
  assert.ok(callback.indexOf('requireCodocsServiceTenantDeploymentBinding(') < callback.indexOf('readBody<WorkflowCallback>'))
})

test('publish request department lookup retains the authenticated request context', () => {
  const route = read('server/api/reviews/publish-requests/index.post.ts')
  assert.match(route, /fetchDirectoryData<[^;]+>\('\/departments', \{ event \}\)/)
})
