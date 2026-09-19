import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function assertBefore(content: string, left: string, right: string) {
  const leftIndex = content.indexOf(left)
  const rightIndex = content.indexOf(right)

  assert.notEqual(leftIndex, -1, `Missing ${left}`)
  assert.notEqual(rightIndex, -1, `Missing ${right}`)
  assert.ok(leftIndex < rightIndex, `${left} must appear before ${right}`)
}

describe('Assets Console auth context order', () => {
  test('tenant runtime middleware resolves Console auth before capability and proxy checks', () => {
    const content = source('server/middleware/tenant-runtime.ts')

    assertBefore(content, 'await ensureAssetsConsoleAuth(event)', 'requireForwardedServiceCapability(event)')
    assertBefore(content, 'await ensureAssetsConsoleAuth(event)', 'maybeProxyCurrentApiToTenantRuntime(event')
  })

  test('public dictionary read stays local and is not proxied through tenant runtime', () => {
    const content = source('server/middleware/tenant-runtime.ts')

    assertBefore(content, 'if (isPublicLocalApiV1Path(pathname)) return', 'await ensureAssetsConsoleAuth(event)')
    assert.match(content, /function isPublicLocalApiV1Path/)
    assert.match(content, /context\.method === 'GET' && \/\^\\\/dictionaries\\\/\?\$\//)
    assert.match(content, /\^\\\/api\\\/v1\\\/dictionaries\\\/\?\$/)
  })

  test('public dictionary read bypasses Foundation console-auth middleware', () => {
    const content = source('nuxt.config.ts')

    assert.match(content, /consoleOidc:\s*{[\s\S]*bypassAuthPaths:\s*consoleAuthBypassPaths/)
    assert.match(content, /}\s*,\s*consoleOidc:\s*{[\s\S]*bypassAuthPaths:\s*consoleAuthBypassPaths/)
    assert.match(content, /'\/api\/v1\/dictionaries'/)
    assert.match(content, /'\/api\/v1\/dictionaries\/'/)
    assert.match(content, /'\/assets\/api\/v1\/dictionaries'/)
    assert.match(content, /'\/assets\/api\/v1\/dictionaries\/'/)
    assert.match(content, /\$\{normalizedAppBasePath\}\/api\/v1\/dictionaries/)
    assert.match(content, /\$\{normalizedAppBasePath\}\/api\/v1\/dictionaries\//)
  })

  test('public dictionary preflight has an explicit local OPTIONS handler', () => {
    const content = source('server/api/v1/dictionaries/index.options.ts')

    assert.match(content, /setResponseStatus\(event, 204\)/)
    assert.match(content, /access-control-allow-methods/)
    assert.match(content, /GET, HEAD, OPTIONS/)
  })

  test('public dictionary HEAD probe has an explicit local handler', () => {
    const content = source('server/api/v1/dictionaries/index.head.ts')

    assert.match(content, /content-type/)
    assert.match(content, /application\/json/)
    assert.match(content, /access-control-allow-methods/)
    assert.match(content, /GET, HEAD, OPTIONS/)
  })

  test('dictionary composable starts from built-in defaults and merges managed categories', () => {
    const content = source('app/composables/useAssetDictionaries.ts')
    const loadBlock = content.slice(
      content.indexOf('async function loadDictionaries'),
      content.indexOf('function getDictionary')
    )

    assert.match(content, /async function loadStoredDictionaries/)
    assert.match(content, /'\/api\/v1\/dictionaries'/)
    assert.match(content, /Promise\.allSettled\(assetCategoryScopeDefinitions\.filter\(item => !hosted \|\| item\.scope === 'product'\)\.map/)
    assert.match(content, /'\/api\/v1\/asset-categories'/)
    assert.match(loadBlock, /const nextDictionaries = cloneDefinitions\(\)/)
    assert.match(loadBlock, /await loadStoredDictionaries\(nextDictionaries, moduleUrl, hosted && scope === 'asset-items'\)/)
    assert.match(loadBlock, /await loadManagedCategoryDictionaries\(nextDictionaries, moduleUrl, hosted\)/)
    assert.match(loadBlock, /dictionaries\.value = nextDictionaries/)
    assert.match(loadBlock, /loaded\.value = true/)
    assert.doesNotMatch(loadBlock, /console\.error\('\[Dictionaries\] Failed to load:'/)
  })

  test('local dictionary read merges runtime persisted dictionaries', () => {
    const routeContent = source('server/api/v1/dictionaries/index.get.ts')
    const repositoryContent = source('server/utils/dictionaryRepository.ts')

    assert.match(routeContent, /getAllDictionaries\(event\)/)
    assert.match(repositoryContent, /maybeCallTenantRuntime/)
    assert.match(repositoryContent, /'\/v1\/assets\/dictionaries'/)
    assert.match(repositoryContent, /definitions\[normalized\.code\] = normalized/)
    assert.match(repositoryContent, /cloneDefinitions\(\)/)
  })

  test('client API auth plugin wraps Nuxt app fetch used by useFetch', () => {
    const content = source('app/plugins/api-auth.client.ts')
    const refreshBlock = content.slice(
      content.indexOf('async function refreshOnce'),
      content.indexOf('async function loginOnce')
    )

    assert.match(content, /defineNuxtPlugin\(\(nuxtApp\)/)
    assert.match(content, /const originalFetch = nuxtApp\.\$fetch \|\| globalThis\.\$fetch/)
    assertBefore(content, 'nuxtApp.$fetch = assetsFetch', 'globalThis.$fetch = assetsFetch')
    assert.match(refreshBlock, /const refresh = auth\.refresh/)
    assert.match(refreshBlock, /await refresh\(\)/)
    assert.doesNotMatch(refreshBlock, /!auth\.token\.value\s*\|\|/)
  })

  test('permission checks resolve Console auth before reading request uid', () => {
    const content = source('server/utils/checkPermission.ts')
    const checkPermissionBlock = content.slice(
      content.indexOf('export async function checkPermission'),
      content.indexOf('/**\n * 要求指定权限')
    )
    const requirePermissionBlock = content.slice(content.indexOf('export async function requirePermission'))

    assertBefore(checkPermissionBlock, 'await ensureAssetsConsoleAuth(event)', 'const uid = getRequestUid(event)')
    assertBefore(requirePermissionBlock, 'await ensureAssetsConsoleAuth(event)', 'const uid = getRequestUid(event)')
  })

  test('local service product APIs require service scope before reading request input', () => {
    const listContent = source('server/api/v1/service/products/index.get.ts')
    const resolveContent = source('server/api/v1/service/products/resolve-codes/index.post.ts')
    const serviceProductsContent = source('server/utils/serviceProducts.ts')
    const middlewareContent = source('server/middleware/tenant-runtime.ts')

    assertBefore(listContent, 'requireServiceScope(event, { scope: \'assets:read\'', 'const query = getQuery(event)')
    assertBefore(resolveContent, 'requireServiceScope(event, { scope: \'assets:read\'', 'const body = await readBody(event)')
    assert.match(listContent, /allowedApps:\s*\['aims', 'altoc'\]/)
    assert.match(resolveContent, /allowedApps:\s*\['aims'\]/)
    assert.match(serviceProductsContent, /productLineLabel:\s*row\.product_line_label \?\? row\.product_line/)
    assert.match(serviceProductsContent, /productLineSortOrder:\s*row\.product_line_sort_order \?\? null/)
    assert.match(serviceProductsContent, /fetchProductPage\(event, \{ product_codes: codes\.join\(','\) \}\)/)
    assert.doesNotMatch(serviceProductsContent, /for \(const code of codes\)[\s\S]{0,160}fetchProductPage/)
    assert.match(middlewareContent, /suffix === '\/service\/products'[\s\S]{0,120}scope: 'assets:read'[\s\S]{0,80}allowedApps: \['aims', 'altoc'\]/)
    assert.match(middlewareContent, /suffix === '\/service\/products\/resolve-codes'[\s\S]{0,120}scope: 'assets:read'[\s\S]{0,80}allowedApps: \['aims'\]/)
    assert.match(middlewareContent, /\/service\\\/deliveries\\\/\[\^\/\]\+\\\/documents\$[\s\S]{0,160}scope: 'assets:write'[\s\S]{0,100}allowedApps: \['aims', 'altoc', 'assets'\]/)
  })

  test('local customer delivery asset activation requires service scope before runtime writes', () => {
    const content = source('server/api/v1/service/customer-delivery-assets/[deliveryAssetCode]/activate.post.ts')

    assertBefore(content, 'requireServiceScope(event, { scope: \'assets:write\'', 'const body = objectBody(await readBody(event))')
    assertBefore(content, 'requireServiceScope(event, { scope: \'assets:write\'', 'const asset = await activateInAssetsRuntime')
    assert.match(content, /allowedApps:\s*\['altoc', 'aims'\]/)
  })

  test('unknown service-only Assets runtime paths are rejected before tenant-runtime proxy', () => {
    const content = source('server/middleware/tenant-runtime.ts')

    assertBefore(content, 'requireForwardedServiceCapability(event)', 'maybeProxyCurrentApiToTenantRuntime(event')
    assert.match(content, /suffix\.startsWith\('\/service\/'\)[\s\S]{0,160}Unsupported Assets service endpoint capability/)
  })

  test('unknown ordinary Assets runtime paths are not proxied with transport-only scopes', () => {
    const content = source('server/middleware/tenant-runtime.ts')

    assert.match(content, /import \{ resolveAssetsApiPermission \}/)
    assert.match(content, /function runtimeStatusFromContext\(context: TenantRuntimeProxyContext\)/)
    assert.match(content, /body\.workflowStatus/)
    assert.match(content, /body\.workflow_status/)
    assert.match(content, /if \(context\.suffix\.startsWith\('\/service\/'\)\) return true/)
    assert.match(content, /return Boolean\(resolveAssetsApiPermission\([\s\S]{0,220}runtimeActionTypeFromContext\(context\)[\s\S]{0,100}runtimeTargetTypeFromContext\(context\)[\s\S]{0,40}\)\)/)
  })
})
