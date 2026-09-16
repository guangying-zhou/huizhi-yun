import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { test } from 'node:test'
import { createAssetsDrainBudget } from '../server/utils/integrationOperationDrainBudget.ts'

const root = resolve(import.meta.dirname, '..')
const read = (path: string) => readFileSync(`${root}/${path}`, 'utf8')

test('Assets activation uses runtime operation and returns 202 while pending', () => {
  const endpoint = read('server/api/v1/service/customer-delivery-assets/[deliveryAssetCode]/activate.post.ts')
  assert.match(endpoint, /altocStatusSyncOperation/)
  assert.match(endpoint, /tryDispatchDeliveryAssetStatusOperation\(event, operationKey\)/)
  assert.match(endpoint, /if \(altocSync\.pending\) setResponseStatus\(event, 202\)/)
  assert.doesNotMatch(endpoint, /buildCustomerDeliveryAssetStatusSyncPayload|requestServiceAccessToken/)
})

test('executor freezes identity, validates receipt and is default-off bounded', () => {
  const executor = read('server/utils/deliveryAssetStatusOperation.ts')
  for (const pattern of [/assets\.delivery-asset\.status-sync\.v1/, /altoc:contract:delivery-asset-status:sync/, /buildServiceCommandEnvelope\(operation\)/, /validateServiceCommandReceipt/, /HZY_ASSETS_STATUS_OPERATIONS_ENABLED/]) assert.match(executor, pattern)
  assert.match(executor, /if \(!assetsStatusOperationsEnabled\(\)\)[\s\S]{0,160}requireAssetsScheduledRuntimeBinding\(\)/)
  assert.match(executor, /maxWallTimeMs: options\.maxWallTimeMs \|\| 45_000/)
  assert.match(executor, /claimReserveMs: options\.claimReserveMs \|\| 25_000/)
})

test('drain stops when less than 25 seconds remain', () => {
  let now = 0
  const budget = createAssetsDrainBudget({ maxClaims: 20, maxWallTimeMs: 45_000, claimReserveMs: 25_000, now: () => now })
  for (const elapsed of [0, 10_000, 20_000]) {
    now = elapsed
    assert.equal(budget.canClaim(), true)
    budget.recordClaim()
  }
  now = 20_001
  assert.equal(budget.canClaim(), false)
  assert.equal(budget.stoppedBy(false), 'max_wall_time')
})

test('source revision and target applied watermark prevent repeated-state reordering', () => {
  const source = read('../data-runtime/internal/apps/assets/delivery_asset_status_operation.go')
  const target = read('../data-runtime/internal/apps/altoc/service_delivery_assets.go')
  assert.match(source, /altoc_status_sync_revision/)
  assert.match(source, /nextAssetsStatusRevision\(revision, storedFingerprint, factsSHA\)/)
  assert.match(source, /altoc-status:revision:%d/)
  assert.doesNotMatch(source, /status:" \+ status/)
  assert.match(target, /assets_delivery_status_projection/)
  assert.match(target, /revision < appliedRevision/)
  assert.match(target, /revision == appliedRevision[\s\S]*appliedSHA != commandSHA/)
  assert.match(target, /staleSkipped/)
  assert.match(target, /repository\.Execute\([\s\S]*syncCustomerDeliveryAssetStatusTx/)
})

test('5xx and source acknowledgement loss remain retryable', () => {
  const executor = read('server/utils/deliveryAssetStatusOperation.ts')
  assert.match(executor, /const response = await io\.callAltoc\(operation\)[\s\S]*await io\.callRuntime<Row>\(`\/v1\/assets\/integration-operations\/\$\{encodeURIComponent\(text\(operation\.operationKey\)\)\}:succeed`/)
  assert.match(executor, /catch \(error\) \{[\s\S]{0,160}pending: true, operation: await fail\(operation, io, error\)/)
  assert.match(executor, /classifyServiceOperationFailure\(error/)
  assert.match(executor, /:fail`/)
})
