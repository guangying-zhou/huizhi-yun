import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

test('Assets product Layer uses the registered scoped base candidate BFF in Host mode', () => {
  const page = source('assets/app/components/assets/ProductAssetsListPage.vue')
  const route = source('enterprise/server/routes/assets/api/v1/products/link-candidates/bases.get.ts')
  const bridge = source('enterprise/server/utils/enterpriseAssetsLinks.ts')

  assert.match(page, /hosted \? '\/api\/v1\/products\/link-candidates\/bases' : '\/api\/v1\/technology-bases'/)
  assert.doesNotMatch(page, /技术底座（尚未组合）/)
  assert.match(route, /handleEnterpriseAssetsLinks\(event, 'base-candidates'\)/)
  assert.match(bridge, /targetAuthorization = await permit\(action\.includes\('asset'\) \? 'asset_items' : 'technology_bases', 'view'\)/)
})

test('Assets Host does not make unregistered standalone APIs look ready', () => {
  const readiness = source('assets/layer/entry.mjs')
  const boundary = source('enterprise/server/middleware/01-business-api.ts')

  for (const route of ['/overview', '/technology-bases/:id']) {
    assert.match(readiness, new RegExp(`'${route.replaceAll('/', '\\/').replaceAll(':', '\\:')}'`))
  }
  assert.match(boundary, /enterprise_module_runtime_not_ready/)
})

test('Assets pages are registered only with their scoped Host BFFs and gate incomplete asset mutations', () => {
  const readiness = source('assets/layer/entry.mjs')
  const physical = source('assets/app/pages/physical.vue')
  const resources = source('assets/app/pages/resources.vue')
  const detail = source('assets/app/pages/items/[id].vue')
  const dictionaries = source('assets/app/pages/admin/dictionaries.vue')
  const digitalAssets = source('assets/app/pages/digital-assets/index.vue')
  const digitalAssetDetail = source('assets/app/pages/digital-assets/[id].vue')
  const ipAssets = source('assets/app/pages/ip-assets/index.vue')
  const ipAssetDetail = source('assets/app/pages/ip-assets/[id].vue')
  const ipCreate = source('assets/app/components/assets/IpAssetCreateModal.vue')
  const ipEdit = source('assets/app/components/assets/IpAssetEditModal.vue')
  const ipWrite = source('enterprise/server/utils/enterpriseIPAssetsWrite.ts')

  for (const route of ['/physical', '/resources', '/items/:id', '/admin/dictionaries', '/digital-assets', '/digital-assets/:id', '/ip-assets', '/ip-assets/:id']) assert.match(readiness, new RegExp(`page\\('${route.replaceAll('/', '\\/').replaceAll(':', '\\:')}'`))
  assert.match(physical, /moduleUrl\('\/api\/v1\/assets'\)/)
  assert.match(resources, /moduleUrl\('\/api\/v1\/assets'\)/)
  assert.match(detail, /moduleUrl\(`\/api\/v1\/assets\/\$\{assetIdentifier\.value\}`\)/)
  assert.ok(digitalAssets.includes("moduleUrl('/api/v1/digital-assets')"))
  assert.ok(digitalAssetDetail.includes('moduleUrl(`/api/v1/digital-assets/${assetId.value}`)'))
  assert.ok(ipAssets.includes("moduleUrl('/api/v1/ip-assets')"))
  assert.ok(ipAssetDetail.includes('moduleUrl(`/api/v1/ip-assets/${assetId.value}`)'))
  assert.match(ipAssets, /key: cacheKey\('ip-assets'\)/)
  assert.match(ipAssetDetail, /key: cacheKey\(`ip-asset:\$\{assetId\.value\}`\)/)
  for (const page of [physical, resources, detail, dictionaries]) assert.match(page, /v-if="!hosted"/)
  for (const page of [digitalAssets, digitalAssetDetail]) assert.match(page, /v-if="!hosted \|\| canEditDigitalAsset"/)
  for (const page of [ipAssets, ipAssetDetail]) assert.match(page, /v-if="!hosted/)
  assert.match(ipCreate, /moduleUrl\('\/api\/v1\/ip-assets'\)/)
  assert.match(ipEdit, /moduleUrl\(`\/api\/v1\/ip-assets\/\$\{props\.asset\.id\}`\)/)
  for (const modal of [ipCreate, ipEdit]) assert.match(modal, /'Idempotency-Key': submissionKey\.value \|\|= crypto\.randomUUID\(\)/)
  assert.match(ipWrite, /assets\.ip-assets-create/)
  assert.match(ipWrite, /resourceCode: 'ip_assets', action: 'edit'/)
})

test('Assets Layer frontend imports resolve from the Assets package in either host', () => {
  for (const path of [
    'assets/app/pages/admin/dictionaries.vue',
    'assets/app/components/assets/DictionaryEditModal.vue',
    'assets/app/composables/useAssetCategories.ts'
  ]) {
    const content = source(path)
    assert.doesNotMatch(content, /from ['"]~~\/shared\//, `${path} must not bind shared imports to the consuming Nuxt root`)
  }
})

test('Assets category state and requests follow the verified Host session scope', () => {
  const categories = source('assets/app/composables/useAssetCategories.ts')

  assert.match(categories, /const \{ moduleUrl, cacheKey \} = useAssetsModule\(\)/)
  assert.match(categories, /useState<AssetCategoryGroup\[\]>\(cacheKey\(`asset-categories-\$\{scope\}`\)/)
  assert.match(categories, /useState<boolean>\(cacheKey\(`asset-categories-\$\{scope\}-loaded`\)/)
  assert.match(categories, /moduleUrl\('\/api\/v1\/asset-categories'\)/)
  assert.doesNotMatch(categories, /useState<[^>]+>\(`asset-categories-/)
})

test('cross-domain batch name resolution keeps the products:view scope and reports unreadable codes as unresolved', () => {
  const route = source('enterprise/server/routes/assets/api/v1/products/resolve-codes.post.ts')
  const service = source('data-runtime/internal/enterprise/product_directory.go')
  const runtime = source('data-runtime/internal/server/enterprise_directory_resolve.go')
  const foundation = source('foundation/server/utils/enterpriseRuntimeClient.ts')
  assert.match(route, /assetsObjectScopeFromScopedAuthorization\(snapshot, 'products', 'view'\)/)
  assert.match(route, /scope\.access === 'none'/)
  assert.match(route, /codes\.length > 200/)
  assert.match(route, /'assets\.product-directory-resolve'/)
  assert.match(foundation, /'assets\.product-directory-resolve': \{ path: '\/v1\/enterprise\/assets\/product-directory:resolve', capability: 'assets:product:read' \}/)
  // Resolve must reuse the list grant predicate and catalog readiness, never widen them.
  assert.match(service, /func \(s ProductDirectoryService\) Resolve\(/)
  assert.match(service, /scope, scopeArgs, err := grantWhere\(id, grant\)/)
  assert.match(service, /if ready != 1 \{\n\t\treturn result, ErrDirectoryChanged/)
  assert.match(service, /directoryResolveLimit = 200/)
  assert.match(runtime, /validateEnterpriseDirectoryAuthorization\(enterpriseDirectoryInput\{Authorization: input\.Authorization\}, verified, time\.Now\(\)\)/)
})

test('product adoption reads the unified authority with one bound permit per object family', () => {
  const route = source('enterprise/server/routes/aims/api/v1/products/[productCode]/adoption.get.ts')
  const runtime = source('data-runtime/internal/server/enterprise_product_adoption.go')
  const adapter = source('data-runtime/internal/apps/assets/enterprise_product_adoption.go')
  const foundation = source('foundation/server/utils/enterpriseRuntimeClient.ts')
  // Both families are compiled for the signed-in user; neither may be widened.
  assert.match(route, /\['deliveryAuthorization', 'deliveries'\], \['environmentAuthorization', 'environments'\]/)
  assert.match(route, /scope\.access === 'none'/)
  assert.match(route, /'assets\.product-adoption-read'/)
  assert.match(foundation, /'assets\.product-adoption-read': \{ path: '\/v1\/enterprise\/assets\/product-adoption:read', capability: 'assets:product-adoption:read' \}/)
  assert.match(runtime, /Capability: "assets:product-adoption:read"/)
  assert.match(runtime, /enterpriseAdoptionScope\(input\.DeliveryAuthorization, "deliveries"/)
  assert.match(runtime, /enterpriseAdoptionScope\(input\.EnvironmentAuthorization, "environments"/)
  // The unified read stays inside one snapshot and fails only itself when the
  // optional compatibility views are missing.
  assert.match(adapter, /BeginSnapshotReadTransaction/)
  assert.match(adapter, /VerifyCompatibilityViewsTx\(ctx, tx, a\.enterpriseReads\.binding, "assets", EnterpriseProductAdoptionViewNames\(\)\)/)
  assert.match(adapter, /enterprise_product_adoption_views_unavailable/)
})
