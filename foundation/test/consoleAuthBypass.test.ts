import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('Console auth bypass paths', () => {
  test('supports app-base-prefixed API paths for module-local public endpoints', () => {
    const content = source('server/middleware/console-auth.ts')

    assert.match(content, /function matchesApiPathWithOptionalAppBase/)
    assert.match(content, /normalizedPath\.startsWith\('\/api\/'\) && pathname\.endsWith\(normalizedPath\)/)
  })

  test('accepts both hzy and top-level consoleOidc bypass path configuration', () => {
    const content = source('server/middleware/console-auth.ts')

    assert.match(content, /config\.hzy\?\.consoleOidc\?\.bypassAuthPaths/)
    assert.match(content, /config\.consoleOidc\?\.bypassAuthPaths/)
  })

  test('has a default Assets dictionary bypass fallback for cached frontend chunks', () => {
    const content = source('server/middleware/console-auth.ts')

    assert.match(content, /function defaultBypassPaths/)
    assert.match(content, /appCode !== 'assets'/)
    assert.match(content, /'\/api\/v1\/dictionaries'/)
    assert.match(content, /'\/assets\/api\/v1\/dictionaries'/)
    assert.match(content, /\.\.\.defaults, \.\.\.config\.hzy\.consoleOidc\.bypassAuthPaths/)
    assert.match(content, /\.\.\.defaults, \.\.\.config\.consoleOidc\.bypassAuthPaths/)
  })

  test('lets Directory Connector service endpoints reach their own service-token verifier', () => {
    const content = source('server/middleware/console-auth.ts')

    assert.match(content, /pathname\.startsWith\('\/api\/v1\/console\/service\/directory-connector\/'\)/)
    assert.doesNotMatch(content, /pathname\.startsWith\('\/api\/v1\/console\/service\/'\)/)
  })

  test('lets Console settings and notification commands reach their exact service-token verifier', () => {
    const content = source('server/middleware/console-auth.ts')

    assert.match(content, /pathname === '\/api\/v1\/console\/settings\/values'/)
    assert.match(content, /pathname === '\/api\/v1\/console\/notifications\/publish'/)
    assert.match(content, /pathname === '\/api\/v1\/console\/notifications\/actionable-lifecycle'/)
    assert.match(content, /pathname === '\/api\/v1\/console\/notifications\/integration-operation-dead-letter'/)
  })

  test('lets the introspection route perform service-token verification without auth recursion', () => {
    const content = source('server/middleware/console-auth.ts')

    assert.match(content, /function isServiceTokenIntrospectionPath/)
    assert.match(content, /pathname === '\/oauth\/introspect'/)
    assert.match(content, /isServiceTokenIntrospectionPath\(pathname\)[\s\S]*shouldBypassConsoleAuth/)
  })

  test('bypasses generic auth only for the exact token handler', () => {
    const content = source('server/middleware/console-auth.ts')
    assert.match(content, /\|\| pathname === '\/oauth\/token'/)
    assert.doesNotMatch(content, /pathname\.startsWith\('\/oauth\/token'/)
    assert.doesNotMatch(content, /pathname\.startsWith\('\/oauth\/'/)
  })
})
