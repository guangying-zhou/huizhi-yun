import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const read = (path: string) => readFileSync(`${root}/${path}`, 'utf8')

test('Aims browser diagnostic routes use the shared allow-list projection', () => {
  const list = read('server/api/v1/integration-operations/index.get.ts')
  const attempts = read('server/api/v1/integration-operations/[operationId]/attempts.get.ts')
  const replay = read('server/api/v1/integration-operations/[operationId]/replay.post.ts')
  const admin = read('server/utils/integrationOperationAdmin.ts')
  assert.match(list, /projectIntegrationOperationList\(data\)/)
  assert.match(attempts, /projectIntegrationOperationAttempts\(data\)/)
  assert.match(replay, /projectIntegrationOperationReplay\(operationId, expectedVersion, reason\)/)
  assert.doesNotMatch(`${list}\n${attempts}\n${replay}`, /return \{ code: 0, data \}/)
  assert.match(admin, /maybeCallTenantRuntime<T>/)
  assert.match(admin, /return runtime\.data/)
  assert.doesNotMatch(admin, /runtime\.data\.data/)
})
