import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('application shell navigation is not persisted as the Console last route', () => {
  const source = readFileSync(
    new URL('../app/plugins/app-last-route.client.ts', import.meta.url),
    'utf8'
  )

  assert.match(
    source,
    /isApplicationShellUrl\(to\.fullPath,\s*window\.location\.origin\)/
  )
  assert.match(
    source,
    /isApplicationShellUrl\(router\.currentRoute\.value\.fullPath,\s*window\.location\.origin\)/
  )
})

test('application navigation may explicitly bypass last-route restoration', () => {
  const rail = readFileSync(
    new URL('../app/components/AppRail.vue', import.meta.url),
    'utf8'
  )
  const launcher = readFileSync(
    new URL('../app/components/AppLauncher.vue', import.meta.url),
    'utf8'
  )

  assert.match(rail, /if \(!app\.restoreLastRoute\) return app\.homeUrl/)
  assert.match(launcher, /if \(app\.restoreLastRoute === false\) return app\.homeUrl/)
})
