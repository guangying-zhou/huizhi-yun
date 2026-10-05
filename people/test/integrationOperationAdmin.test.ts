import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path: string) => readFileSync(`${root}/${path}`, 'utf8')

test('People integration operation administration keeps BFF, runtime and UI on the narrow family', () => {
  const runtime = read('../data-runtime/internal/apps/people/integration_operation_admin.go')
  const assetsFamily = read('../data-runtime/internal/apps/people/assets_offboarding_projection.go')
  const directoryFamily = read('../data-runtime/internal/apps/people/directory_lifecycle_operation.go')
  const admin = read('server/utils/integrationOperationAdmin.ts')
  const middleware = read('server/middleware/tenant-runtime.ts')
  const manifest = JSON.parse(read('app.manifest.json')) as { resources: Array<{ code: string, actions: string[] }> }
  const page = read('app/pages/integration-operations.vue')

  assert.match(directoryFamily, /people\.directory\.employment-sync\.v1/)
  assert.match(directoryFamily, /people\.directory\.offboarding-disable\.v1/)
  assert.match(assetsFamily, /people\.offboarding\.assets-recovery-sync\.v1/)
  assert.match(runtime, /requireAllowedPeopleIntegrationOperation/)
  assert.match(runtime, /candidate leaked|safe DTO boundary/)
  assert.match(admin, /hasTenantGlobalIntegrationOperationGrant/)
  assert.match(admin, /people:integration_operations:\$\{action\}/)
  assert.match(middleware, /integration-operations\(\?:/)
  assert.match(page, /source-app="people"/)
  assert.deepEqual(manifest.resources.find(item => item.code === 'integration_operations')?.actions, ['view', 'replay'])
})
