import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('integration management is a Console BFF over exact tenant-runtime contracts', () => {
  const integration = source('server/utils/integrations.ts')
  const foundation = source('../foundation/server/utils/consoleTenantRuntimeClient.ts')
  const runtime = source('../data-runtime/internal/apps/console/integrations.go')

  assert.match(integration, /listConsoleIntegrations\(event, query\)/)
  assert.match(integration, /getConsoleIntegration\(event, integrationCode\)/)
  assert.match(integration, /createConsoleIntegration\(event/)
  assert.match(integration, /updateConsoleIntegration\(/)
  assert.match(integration, /rotateConsoleIntegrationCredential\(/)
  assert.match(integration, /checkConsoleIntegration\(/)
  assert.match(foundation, /console:integration:view/)
  assert.match(foundation, /console:integration:edit/)
  assert.match(foundation, /console:integration:rotate/)
  assert.match(foundation, /console:integration:test/)
  assert.match(runtime, /func \(a \*Adapter\) ListIntegrations/)
  assert.match(runtime, /func \(a \*Adapter\) CreateIntegration/)
  assert.match(runtime, /func \(a \*Adapter\) UpdateIntegration/)
  assert.match(runtime, /func \(a \*Adapter\) RotateIntegrationCredential/)
  assert.match(runtime, /func \(a \*Adapter\) CheckIntegration/)
  assert.match(runtime, /beginMutation\(/)
  assert.match(runtime, /finishMutation\(/)
  assert.match(runtime, /must be stored in Vault/)
})

test('integration mutations require browser idempotency keys before tenant-runtime writes', () => {
  const createRoute = source('server/api/v1/console/integrations/index.post.ts')
  const updateRoute = source('server/api/v1/console/integrations/[integrationCode].patch.ts')
  const rotateRoute = source('server/api/v1/console/integrations/[integrationCode]/rotate.post.ts')
  const checkRoute = source('server/api/v1/console/integrations/[integrationCode]/check.post.ts')
  const page = source('app/pages/integrations.vue')

  for (const route of [createRoute, updateRoute, rotateRoute, checkRoute]) {
    assert.match(route, /requireIntegrationAccess\(event, 'edit'\)[\s\S]*requireIdempotencyKey\(event/)
  }
  assert.ok((page.match(/headers: \{ 'Idempotency-Key': crypto\.randomUUID\(\) \}/g) || []).length >= 5)
})
