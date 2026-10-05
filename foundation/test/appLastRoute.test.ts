import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveAppEntryUrlForSaved, shouldRestoreLastRouteOnLanding } from '../app/utils/appLastRoute.ts'

const origin = 'https://wiztek.huizhi.yun'

test('saving an app home route clears the stale last route', () => {
  const source = readFileSync(new URL('../app/utils/appLastRoute.ts', import.meta.url), 'utf8')

  assert.match(
    source,
    /if \(normalized === '\/'\) \{\s*clearLastRoute\(code\)\s*return\s*\}/
  )
})

test('app entry URL falls back to home when saved route equals home route', () => {
  assert.equal(resolveAppEntryUrlForSaved('/admin', '/admin', origin, '/', 'console'), '/admin')
})

test('app entry URL collapses repeated home path from polluted saved routes', () => {
  assert.equal(resolveAppEntryUrlForSaved('/admin', '/admin/admin', origin, '/', 'console'), '/admin')
  assert.equal(
    resolveAppEntryUrlForSaved('/admin', '/admin/admin/logs?level=error#latest', origin, '/', 'console'),
    'https://wiztek.huizhi.yun/admin/logs?level=error#latest'
  )
})

test('app entry URL uses root base path for Console non-admin routes', () => {
  assert.equal(
    resolveAppEntryUrlForSaved('/admin', '/directory/departments', origin, '/', 'console'),
    'https://wiztek.huizhi.yun/directory/departments'
  )
})

test('Console entry does not restore workspace-only routes', () => {
  for (const route of ['/profile', '/settings/profile', '/todos', '/approval/tasks', '/notifications', '/notifications/notif_123']) {
    assert.equal(resolveAppEntryUrlForSaved('/admin', route, origin, '/', 'console'), '/admin')
  }
})

test('app entry URL strips polluted Console home prefix from root routes', () => {
  assert.equal(
    resolveAppEntryUrlForSaved('/admin', '/admin/directory/departments', origin, '/', 'console'),
    'https://wiztek.huizhi.yun/directory/departments'
  )
})

test('app entry URL preserves real Console admin child routes', () => {
  assert.equal(
    resolveAppEntryUrlForSaved('/admin', '/admin/logs', origin, '/', 'console'),
    'https://wiztek.huizhi.yun/admin/logs'
  )
})

test('app entry URL keeps ordinary app-relative saved routes', () => {
  assert.equal(
    resolveAppEntryUrlForSaved('/aims', '/projects/33/documents', origin, '/aims/'),
    'https://wiztek.huizhi.yun/aims/projects/33/documents'
  )
})

test('app entry URL does not restore a previously persisted no-access page', () => {
  assert.equal(
    resolveAppEntryUrlForSaved('/assets', '/no-access', origin, '/assets/', 'assets'),
    '/assets'
  )
  assert.equal(
    resolveAppEntryUrlForSaved('/assets', '/assets/no-access', origin, '/assets/', 'assets'),
    '/assets'
  )
})

test('app entry URL does not restore an embedded document route', () => {
  assert.equal(
    resolveAppEntryUrlForSaved(
      '/codocs',
      '/embed/editor/document-uuid?readonly=1&title=0',
      origin,
      '/codocs/',
      'codocs',
      'app-relative'
    ),
    '/codocs'
  )
})

test('app entry URL does not duplicate app base path when saved route already includes it', () => {
  assert.equal(
    resolveAppEntryUrlForSaved('/aims', '/aims/projects/33/documents', origin, '/aims/'),
    'https://wiztek.huizhi.yun/aims/projects/33/documents'
  )
})

test('app-relative route may legitimately repeat the deployment base path', () => {
  assert.equal(
    resolveAppEntryUrlForSaved(
      '/assets',
      '/assets/physical?status=in_stock#inventory',
      origin,
      '/assets/',
      'assets',
      'app-relative'
    ),
    'https://wiztek.huizhi.yun/assets/assets/physical?status=in_stock#inventory'
  )
})

test('last route restore does not hijack Console workspace landing', () => {
  assert.equal(shouldRestoreLastRouteOnLanding('console', '/', 0), false)
})

test('last route restore only runs on initial app home landing', () => {
  assert.equal(shouldRestoreLastRouteOnLanding('aims', '/', 0), true)
  assert.equal(shouldRestoreLastRouteOnLanding('aims', '/projects', 0), false)
  assert.equal(shouldRestoreLastRouteOnLanding('aims', '/', 1), false)
})
