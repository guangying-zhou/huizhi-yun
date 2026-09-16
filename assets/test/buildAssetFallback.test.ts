import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('Assets build asset fallback guard', () => {
  test('missing Nuxt build assets return 404 no-store instead of SPA HTML', () => {
    const content = source('server/middleware/build-asset-not-found.ts')

    assert.match(content, /pathname\.startsWith\('\/_nuxt\/'\)/)
    assert.match(content, /pathname\.startsWith\(`\$\{basePath\}\/_nuxt\/`\)/)
    assert.match(content, /setResponseStatus\(event, 404\)/)
    assert.match(content, /Build asset not found/)
    assert.match(content, /no-store, no-cache, must-revalidate, max-age=0/)
  })
})
