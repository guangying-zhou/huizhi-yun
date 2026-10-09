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

describe('Console activation refresh permission', () => {
  test('admin bundle refresh requires system_settings/admin before runtime checks', () => {
    const content = source('server/api/activation/bundle-refresh.post.ts')

    assertBefore(
      content,
      'requirePermission(event, \'system_settings\', \'admin\'',
      'loadConsoleRuntimeMode(event)'
    )
    assertBefore(
      content,
      'requirePermission(event, \'system_settings\', \'admin\'',
      'refreshPlatformBundle(\'admin-open-refresh\''
    )
  })

  test('manual retry stays public before activation and requires admin after activation', () => {
    const content = source('server/api/activation/retry.post.ts')

    assertBefore(content, 'loadActivationStatus(event)', 'refreshPlatformBundle(\'manual-retry\'')
    assert.match(
      content,
      /if \(status\.activated\) \{\s+await requirePermission\(event, 'system_settings', 'admin'/
    )
  })

  test('admin page skips the write-side bundle refresh during simulation or without admin permission', () => {
    const content = source('app/middleware/platform-bundle-refresh.global.ts')
    const refreshRequest = '$fetch<BundleRefreshResponse>(\'/api/activation/bundle-refresh\''

    assert.match(content, /defineNuxtRouteMiddleware\(async \(to\)/)
    assert.match(content, /loadSession\(\{ force: true \}\)/)
    assert.match(content, /if \(simulation\.active\) \{\s+return/)
    assert.match(content, /loadPermissions\(\{ force: true \}\)/)
    assert.match(content, /hasPermission\('system_settings', 'admin'\)/)
    assertBefore(content, 'loadSession({ force: true })', refreshRequest)
    assertBefore(content, 'hasPermission(\'system_settings\', \'admin\')', refreshRequest)
  })
})
