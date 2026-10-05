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

describe('Console vault reveal permissions', () => {
  test('plaintext reveal requires credential vault admin access before reading payload', () => {
    const content = source('server/api/v1/console/vault/secrets/[secretCode]/reveal.post.ts')
    const handlerBlock = content.slice(content.indexOf('export default defineEventHandler'))

    assertBefore(
      handlerBlock,
      'requirePermission(event, \'credential_vault\', \'admin\')',
      'readBody<{'
    )
    assertBefore(
      handlerBlock,
      'requirePermission(event, \'credential_vault\', \'admin\')',
      'revealConsoleVaultSecret'
    )
    assert.doesNotMatch(handlerBlock, /requirePermission\(event, 'credential_vault', 'edit'\)/)
    assert.match(handlerBlock, /Cache-Control', 'no-store, max-age=0'/)
  })

  test('vault page gates plaintext reveal separately from secret create and rotate', () => {
    const content = source('app/pages/vault.vue')

    assert.match(content, /const canEditVault = computed\(\(\) => permissionsLoaded\.value && hasPermission\('credential_vault', 'edit'\)\)/)
    assert.match(content, /const canAdminVault = computed\(\(\) => permissionsLoaded\.value && hasPermission\('credential_vault', 'admin'\)\)/)
    assert.match(content, /if \(!canAdminVault\.value\) \{[\s\S]*需要凭证库管理员权限/)
    assert.match(content, /:disabled="!canEditVault"[\s\S]*@click="createSecret"/)
    assert.match(content, /:disabled="!canEditVault"[\s\S]*@click="rotateSecret"/)
    assert.match(content, /:disabled="!canAdminVault"[\s\S]*@click="openReveal/)
    assert.match(content, /:disabled="!canAdminVault"[\s\S]*@click="revealSecret"/)
  })
})
