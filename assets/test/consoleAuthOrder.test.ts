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
})
