import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { resolvePlatformRegistryTenant } from '../src/index.js'

function cachedRegistryResponse(cachedAt) {
  return new Response(JSON.stringify({
    tenantCode: 'C000001',
    deploymentCode: 'C000001-console',
    allowed: true,
    apps: { finance: { deploymentCode: 'C000001-finance' } }
  }), {
    headers: {
      'content-type': 'application/json',
      'x-hzy-registry-cached-at': String(cachedAt)
    }
  })
}

describe('tenant gateway Platform registry cache', () => {
  test('serves a fresh edge registry entry without querying Platform', async () => {
    let fetches = 0
    const value = await resolvePlatformRegistryTenant(
      'fresh-cache.huizhi.yun',
      {
        HZY_ALLOWED_TENANTS: 'C000001',
        HZY_TENANT_GATEWAY_REGISTRY_URL: 'https://platform.example.test/api/resolve'
      },
      async () => {
        fetches += 1
        return new Response(null, { status: 500 })
      },
      { async match() { return cachedRegistryResponse(Date.now()) } }
    )

    assert.equal(fetches, 0)
    assert.equal(value.tenantCode, 'C000001')
    assert.equal(value.apps.finance.deploymentCode, 'C000001-finance')
  })

  test('falls back to a stale edge registry entry when Platform is unavailable', async () => {
    let fetches = 0
    const value = await resolvePlatformRegistryTenant(
      'stale-cache.huizhi.yun',
      {
        HZY_ALLOWED_TENANTS: 'C000001',
        HZY_TENANT_GATEWAY_REGISTRY_URL: 'https://platform.example.test/api/resolve'
      },
      async () => {
        fetches += 1
        return new Response(null, { status: 500 })
      },
      { async match() { return cachedRegistryResponse(Date.now() - 10 * 60 * 1000) } }
    )

    assert.equal(fetches, 1)
    assert.equal(value.tenantCode, 'C000001')
    assert.equal(value.allowed, true)
  })

  test('reapplies the current tenant allowlist to cached registry data', async () => {
    const value = await resolvePlatformRegistryTenant(
      'changed-allowlist.huizhi.yun',
      {
        HZY_ALLOWED_TENANTS: 'C999999',
        HZY_TENANT_GATEWAY_REGISTRY_URL: 'https://platform.example.test/api/resolve'
      },
      async () => new Response(null, { status: 500 }),
      { async match() { return cachedRegistryResponse(Date.now()) } }
    )

    assert.equal(value.tenantCode, 'C000001')
    assert.equal(value.allowed, false)
  })

  test('stores a successful Platform registry response in the edge cache', async () => {
    const puts = []
    const value = await resolvePlatformRegistryTenant(
      'write-cache.huizhi.yun',
      {
        HZY_ALLOWED_TENANTS: 'C000001',
        HZY_TENANT_GATEWAY_REGISTRY_URL: 'https://platform.example.test/api/resolve'
      },
      async () => new Response(JSON.stringify({
        data: {
          tenantCode: 'C000001',
          deploymentCode: 'C000001-console',
          apps: {}
        }
      }), { headers: { 'content-type': 'application/json' } }),
      {
        async match() { return null },
        async put(request, response) { puts.push({ request, response }) }
      }
    )

    assert.equal(value.tenantCode, 'C000001')
    assert.equal(puts.length, 1)
    assert.match(puts[0].request.url, /__hzy_tenant_gateway_registry_cache_v2=1/)
    assert.equal(puts[0].response.headers.get('cache-control'), 'public, max-age=86400')
  })
})
