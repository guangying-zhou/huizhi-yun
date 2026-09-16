import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function workspaceSource(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
}

test('Console Vault management routes use the customer Tenant Runtime boundary', () => {
  for (const path of [
    'server/api/v1/console/vault/secrets/index.get.ts',
    'server/api/v1/console/vault/secrets/index.post.ts',
    'server/api/v1/console/vault/secrets/[secretCode]/versions.post.ts',
    'server/api/v1/console/vault/secrets/[secretCode]/rotate.post.ts',
    'server/api/v1/console/vault/secrets/[secretCode]/reveal.post.ts'
  ]) {
    const route = source(path)
    assert.match(route, /consoleTenantRuntimeClient/)
    assert.doesNotMatch(route, /server\/utils\/vault/)
  }

  for (const path of [
    'server/api/v1/console/vault/secrets/index.post.ts',
    'server/api/v1/console/vault/secrets/[secretCode]/versions.post.ts',
    'server/api/v1/console/vault/secrets/[secretCode]/rotate.post.ts'
  ]) {
    assert.match(source(path), /requireIdempotencyKey\(event\)/)
  }
})

test('Vault Runtime owns encryption, exact capabilities, receipts, and secret-free audit metadata', () => {
  const client = workspaceSource('foundation/server/utils/consoleTenantRuntimeClient.ts')
  const runtime = workspaceSource('data-runtime/internal/apps/console/vault.go')
  const crypto = workspaceSource('data-runtime/internal/apps/console/vault_crypto.go')
  const consolePlatformRuntime = source('server/utils/platformRuntime.ts')
  const consoleConfig = source('nuxt.config.ts')

  assert.match(client, /console:vault-secret:view/)
  assert.match(client, /console:vault-secret:edit/)
  assert.match(client, /console:vault-secret:reveal/)
  assert.match(crypto, /aes-256-gcm/)
  assert.match(crypto, /HZY_CONSOLE_VAULT_MASTER_KEY|vaultMasterKey/)
  assert.match(runtime, /beginMutation/)
  assert.match(runtime, /finishMutation/)
  assert.match(runtime, /vault_access_logs/)
  assert.doesNotMatch(runtime, /finishMutation\([\s\S]{0,500}"plaintext"/)
  assert.doesNotMatch(runtime, /insertVaultAccessLog\([\s\S]{0,300}"plaintext"/)
  assert.doesNotMatch(consolePlatformRuntime, /HZY_CONSOLE_VAULT_MASTER_KEY|CONSOLE_VAULT_MASTER_KEY|vaultMasterKey/)
  assert.doesNotMatch(consoleConfig, /HZY_CONSOLE_VAULT_MASTER_KEY|CONSOLE_VAULT_MASTER_KEY|vaultMasterKey/)
})

test('Vault UI supplies idempotency keys for create and rotate calls', () => {
  const vaultPage = source('app/pages/vault.vue')
  const integrationsPage = source('app/pages/integrations.vue')

  assert.ok((vaultPage.match(/'Idempotency-Key': crypto\.randomUUID\(\)/g) || []).length >= 2)
  assert.ok((integrationsPage.match(/'Idempotency-Key': crypto\.randomUUID\(\)/g) || []).length >= 2)
})
