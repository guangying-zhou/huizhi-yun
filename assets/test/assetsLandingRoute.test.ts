import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'
import {
  matchRouteRule,
  resolveAssetsLandingRoute,
  type PermissionAction
} from '../app/config/permissions.ts'

function checker(permissions: string[]) {
  const available = new Set(permissions)
  return (resource: string, action: PermissionAction) => available.has(`${resource}:${action}`)
}

describe('Assets application landing route', () => {
  test('keeps the dashboard as the default when it is available', () => {
    assert.equal(
      resolveAssetsLandingRoute(checker(['dashboard:view', 'assignments:request'])),
      '/'
    )
  })

  test('sends a self-service asset user to assignments without widening dashboard access', () => {
    assert.equal(
      resolveAssetsLandingRoute(checker(['asset_items:view', 'assignments:view', 'assignments:request', 'alerts:view'])),
      '/operations/assignments'
    )
  })

  test('uses the first existing read capability for non-dashboard roles', () => {
    assert.equal(resolveAssetsLandingRoute(checker(['asset_items:view'])), '/physical')
    assert.equal(resolveAssetsLandingRoute(checker(['purchase_orders:view'])), '/procurement/orders')
    assert.equal(resolveAssetsLandingRoute(checker(['alerts:view'])), '/alerts')
  })

  test('uses canonical asset routes without a repeated application base segment', () => {
    assert.deepEqual(matchRouteRule('/physical'), { pattern: '/physical', resource: 'asset_items', action: 'view' })
    assert.deepEqual(matchRouteRule('/resources'), { pattern: '/resources', resource: 'asset_items', action: 'view' })
    assert.deepEqual(matchRouteRule('/items/pub-asset-42'), { pattern: '/items/**', resource: 'asset_items', action: 'view' })
    assert.deepEqual(matchRouteRule('/ip-assets'), { pattern: '/ip-assets', resource: 'ip_assets', action: 'view' })
    assert.deepEqual(matchRouteRule('/digital-assets'), { pattern: '/digital-assets', resource: 'digital_assets', action: 'view' })
    assert.equal(matchRouteRule('/assets/physical'), null)
    assert.equal(matchRouteRule('/assets/resources'), null)
  })

  test('drops an old nested last-route record without redirecting the removed URL', () => {
    const plugin = readFileSync(
      new URL('../app/plugins/clear-legacy-last-route.client.ts', import.meta.url),
      'utf8'
    )

    assert.match(plugin, /savedPath === '\/assets'/)
    assert.match(plugin, /savedPath\?\.startsWith\('\/assets\/'\)/)
    assert.match(plugin, /clearLastRoute\(appCode\)/)
    assert.doesNotMatch(plugin, /navigateTo|redirect/)
  })

  test('fails closed when the role has no Assets permission', () => {
    assert.equal(resolveAssetsLandingRoute(checker([])), null)
  })

  test('applies the same fallback to the legacy application catalog overview entry', () => {
    const middleware = readFileSync(
      new URL('../app/middleware/permission.global.ts', import.meta.url),
      'utf8'
    )

    assert.match(middleware, /to\.path === '\/' \|\| to\.path === '\/overview'/)
    assert.match(middleware, /landingRoute !== to\.path/)
  })
})
