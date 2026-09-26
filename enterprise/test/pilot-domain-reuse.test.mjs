import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const root = new URL('../../', import.meta.url).pathname
const read = path => readFileSync(join(root, path), 'utf8')
const files = directory => readdirSync(join(root, directory), { recursive: true })
  .map(name => join(directory, name))
  .filter(name => statSync(join(root, name)).isFile() && name.endsWith('.ts'))

test('pilot Host routes contain no parallel SQL or database state machine', () => {
  const routeRoots = ['enterprise/server/routes/aims/api/v1/products', 'enterprise/server/routes/assets/api/v1']
  const routes = routeRoots.flatMap(files)
  assert.equal(routes.filter(path => path.includes('/aims/')).length, 76)
  assert.equal(routes.filter(path => path.includes('/assets/')).length, 30)
  for (const path of routes) {
    const source = read(path)
    assert.doesNotMatch(source, /\b(?:SELECT|INSERT|UPDATE|DELETE)\s+(?:FROM|INTO|[a-z_]+\s+SET)\b/i, relative(root, path))
    assert.doesNotMatch(source, /(?:mysql|drizzle|prisma|useDatabase|\.query\s*\()/i, relative(root, path))
  }
})

test('request create old and Enterprise entries share one Aims handler', () => {
  const standalone = read('aims/server/api/v1/products/[productCode]/requests/index.post.ts')
  const hosted = read('enterprise/server/routes/aims/api/v1/products/[productCode]/requests.post.ts')
  const handler = read('aims/server/utils/productRequestCreateRuntime.ts')
  const bridge = read('enterprise/server/utils/enterpriseProductRequestActions.ts')
  assert.match(standalone, /defineEventHandler\(handleProductRequestCreate\)/)
  assert.match(hosted, /handleProductRequestCreate\(event, await enterpriseProductRequestActions\(event\)\)/)
  assert.match(handler, /bridge\.call\(code, 'create', body, key\)/)
  assert.match(handler, /requests:create/)
  assert.match(bridge, /'create': 'aims\.product-request-create'/)
})

test('every pilot route is a thin shared handler or declared Enterprise adapter', () => {
  const aims = files('enterprise/server/routes/aims/api/v1/products')
  const assets = files('enterprise/server/routes/assets/api/v1')
  const declaredAims = /enterpriseProduct(List|Onboard|Workspace|RequestRead|HandoffCandidates|Components|Documents|DocumentLink)|'assets\.product-adoption-read'/
  const declaredAssets = /handleEnterprise(?:Assets(Products|Read|Categories|Links)|DigitalAssets(?:Read|Write)|IPAssets(?:Read|Write|LinkProduct))/
  for (const path of aims) {
    const source = read(path)
    assert.ok(source.includes('/aims/server/') || declaredAims.test(source), relative(root, path))
  }
  for (const path of assets) {
    const source = read(path)
    assert.ok(source.includes('/assets/server/') || declaredAssets.test(source), relative(root, path))
  }
})

test('Enterprise utility routes have explicit old-entry and Runtime-domain evidence', () => {
  const foundation = read('foundation/server/utils/enterpriseRuntimeClient.ts')
  const mappings = [
    ['enterpriseProductList', 1, 'aims/server/api/v1/products/index.get.ts', 'data-runtime/internal/apps/aims/product_list.go'],
    ['enterpriseProductOnboarding', 1, 'aims/server/api/v1/products/index.post.ts', 'data-runtime/internal/apps/aims/product_onboard.go'],
    ['enterpriseProductWorkspace', 1, 'aims/server/api/v1/products/[productCode].get.ts', 'data-runtime/internal/apps/aims/product_workspace.go'],
    ['enterpriseProductRequestRead', 2, 'aims/server/api/v1/products/[productCode]/requests/index.get.ts', 'data-runtime/internal/apps/aims/product_requests.go'],
    ['enterpriseProductHandoffCandidates', 2, 'aims/server/api/v1/products/[productCode]/planning-items/index.get.ts', 'data-runtime/internal/apps/aims/product_handoff_runtime.go'],
    ['enterpriseProductComponents', 5, 'aims/server/api/v1/products/[productCode]/components/index.get.ts', 'data-runtime/internal/apps/aims/product_center_components.go'],
    ['enterpriseProductDocuments', 4, 'aims/server/api/v1/products/[productCode]/roadmaps/[...roadmapPath].ts', 'data-runtime/internal/enterpriseplanning/product_document_reads.go'],
    ['enterpriseProductDocumentLink', 1, 'aims/server/api/v1/products/[productCode]/roadmaps/[...roadmapPath].ts', 'data-runtime/internal/apps/aims/productcenter/product_document_create.go'],
    ['enterpriseAssetsProducts', 6, 'assets/server/api/v1/products/index.get.ts', 'data-runtime/internal/apps/assets/product_master_commands.go'],
    ['enterpriseAssetsRead', 3, 'assets/server/api/v1/assets/index.get.ts', 'data-runtime/internal/apps/assets/adapter.go'],
	['enterpriseDigitalAssetsRead', 2, 'assets/server/api/v1/digital-assets/index.get.ts', 'data-runtime/internal/apps/assets/runtime_catalog.go'],
	['enterpriseDigitalAssetsWrite', 2, 'assets/server/api/v1/digital-assets/index.post.ts', 'data-runtime/internal/apps/assets/digital_asset_commands.go'],
    ['enterpriseAssetsCategories', 3, 'assets/server/api/v1/admin/asset-categories/index.get.ts', 'data-runtime/internal/apps/assets/product_master_commands.go'],
    ['enterpriseAssetsLinks', 5, 'assets/server/api/v1/products/[id]/assets.post.ts', 'data-runtime/internal/apps/assets/product_link_commands.go'],
    ['enterpriseIPAssetsRead', 3, 'assets/server/api/v1/ip-assets/index.get.ts', 'data-runtime/internal/apps/assets/ip_asset_commands.go'],
    ['enterpriseIPAssetsWrite', 2, 'assets/server/api/v1/ip-assets/index.post.ts', 'data-runtime/internal/apps/assets/ip_asset_commands.go']
  ]
  const routes = [...files('enterprise/server/routes/aims/api/v1/products'), ...files('enterprise/server/routes/assets/api/v1')]
  let covered = 0
  for (const [utility, expectedRoutes, oldEntry, domainAdapter] of mappings) {
    const utilityPath = `enterprise/server/utils/${utility}.ts`
    const source = read(utilityPath)
    const usedBy = routes.filter(path => read(path).includes(utility))
    assert.equal(usedBy.length, expectedRoutes, utility)
    assert.ok(read(oldEntry).length > 0, oldEntry)
    assert.ok(read(domainAdapter).length > 0, domainAdapter)
    assert.doesNotMatch(source, /\b(?:SELECT|INSERT|UPDATE|DELETE)\s+(?:FROM|INTO|[a-z_]+\s+SET)\b/i, utility)
    const operations = [...source.matchAll(/['"]((?:aims|assets)\.[a-z0-9_.-]+)['"]/g)].map(match => match[1])
    if (!source.includes('/aims/server/')) assert.ok(operations.length > 0, `${utility} has no shared handler or Runtime operation`)
    for (const operation of operations) assert.ok(foundation.includes(`'${operation}'`), `${utility}: undeclared ${operation}`)
    covered += usedBy.length
  }
	assert.equal(covered, 43)
})

test('Assets product create and edit converge on one owning receipt command', () => {
  const middleware = read('assets/server/middleware/tenant-runtime.ts')
  const permissions = read('assets/server/utils/assetsPermissionRoutes.ts')
  const runtime = read('data-runtime/internal/apps/assets/runtime_writes.go')
  const receipt = read('data-runtime/internal/apps/assets/product_master_receipts.go')
  const enterprise = read('data-runtime/internal/server/enterprise_assets_products.go')
  const mysql = read('data-runtime/internal/server/enterprise_assets_products_mysql_test.go')
  assert.match(middleware, /maybeProxyCurrentApiToTenantRuntime/)
  assert.match(permissions, /normalizedPath\.startsWith\('products'\)/)
  assert.match(runtime, /executeLegacyProductMaster\(ctx, "create"/)
  assert.match(runtime, /executeLegacyProductMaster\(ctx, "edit"/)
  assert.match(receipt, /ExecuteProductMasterInTransaction/)
  assert.match(receipt, /repo\.ExecuteOwnedInTransaction/)
  assert.match(enterprise, /enterpriseAssetsProducts\.Command\(r\.Context\(\), command, action/)
  assert.match(mysql, /cross-entry replay duplicated/)
  assert.match(mysql, /call\(false, "create", "fixed-non-v4-key"/)
  assert.match(mysql, /call\(true, "create", "fixed-non-v4-key"/)
  assert.match(mysql, /expect\(code, out, 409\)/)
})
