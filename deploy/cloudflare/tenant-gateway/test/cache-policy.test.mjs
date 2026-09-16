import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cachePolicyFor,
  isAppBuildAssetPath,
  isHtmlResponse,
  rewriteResponse,
  shouldNoStoreAppResponse
} from '../src/index.js'

describe('tenant gateway app asset cache policy', () => {
  test('Console HTML navigations are marked no-store', () => {
    const request = new Request('https://wiztek.huizhi.yun/connector-runtime', {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'sec-fetch-dest': 'document'
      }
    })

    assert.equal(shouldNoStoreAppResponse(request, '/'), true)
  })

  test('hashed Nuxt build assets use immutable browser and edge caching', () => {
    assert.deepEqual(cachePolicyFor('/assets/_nuxt/entry.abc123.js', '/assets/'), {
      cacheEverything: true,
      cacheTtl: 60 * 60 * 24 * 365
    })
    assert.deepEqual(cachePolicyFor('/_nuxt/entry.abc123.js', '/'), {
      cacheEverything: true,
      cacheTtl: 60 * 60 * 24 * 365
    })
    assert.equal(isAppBuildAssetPath('/assets/_nuxt/old-entry.js', '/assets/'), true)

    const response = rewriteResponse(
      new Response('console.log("ok")', { headers: { 'cache-control': 'no-store' } }),
      new Request('https://wiztek.huizhi.yun/_nuxt/entry.abc123.js'),
      {},
      { immutable: true }
    )
    assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable')
  })

  test('app HTML navigations are marked no-store', () => {
    const request = new Request('https://wiztek.huizhi.yun/assets/procurement/orders', {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'sec-fetch-dest': 'document'
      }
    })

    assert.equal(shouldNoStoreAppResponse(request, '/assets/'), true)
  })

  test('app APIs and build assets are not treated as HTML navigations', () => {
    assert.equal(shouldNoStoreAppResponse(new Request('https://wiztek.huizhi.yun/assets/api/v1/dictionaries'), '/assets/'), false)
    assert.equal(shouldNoStoreAppResponse(new Request('https://wiztek.huizhi.yun/assets/_nuxt/current.js'), '/assets/'), false)
  })

  test('HTML fallback responses can be detected without reading the body', () => {
    assert.equal(isHtmlResponse(new Response('<!doctype html>', {
      headers: { 'content-type': 'text/html;charset=utf-8' }
    })), true)
    assert.equal(isHtmlResponse(new Response('console.log(1)', {
      headers: { 'content-type': 'text/javascript' }
    })), false)
  })
})
