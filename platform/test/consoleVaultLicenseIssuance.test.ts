import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

// Evaluate the production helper with its DB dependency replaced by an executor.
function vaultModule() {
  const { outputText } = ts.transpileModule(source('server/utils/deploymentBootstrapSecrets.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  })
  const exports: Record<string, unknown> = {}
  const require = createRequire(import.meta.url)
  runInNewContext(outputText, {
    exports,
    require: (name: string) => name === '~~/server/utils/db' ? {} : require(name),
    Buffer,
    createError: (input: object) => Object.assign(new Error('vault error'), input)
  })
  return exports as {
    resolveConsoleVaultMasterKeyForIssuance: (input: object) => Promise<{ mode: 'customer-held' } | { mode: 'platform-held', key: string, fingerprint: string }>
    ensureConsoleVaultMasterKey: (input: object) => Promise<string>
    consoleVaultLicenseMetadata: (custody: object) => { masterKeyRequired: boolean, masterKeyFingerprint: string, algorithm: string } | null
    fingerprintConsoleVaultMasterKey: (value: string) => string
  }
}

function licensePayload(input: object) {
  const { outputText } = ts.transpileModule(source('server/utils/licenseArtifacts.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  })
  const exports: Record<string, unknown> = {}
  const require = createRequire(import.meta.url)
  runInNewContext(outputText, {
    exports,
    require: (name: string) => name === '~~/server/utils/platformSigning' ? {} : require(name)
  })
  return (exports.buildLicensePayload as (input: object) => Record<string, unknown>)(input)
}

function executor(initial: { id: number, secret_value: string, status: string } | null) {
  let row = initial
  let writes = 0
  return {
    get row() { return row },
    get writes() { return writes },
    async queryRow(sql: string) {
      if (sql.includes('status = \'active\'')) return row?.status === 'active' ? row : null
      return row
    },
    async execute(_sql: string, params: unknown[]) {
      writes++
      row = { id: 1, secret_value: String(params[4]), status: 'active' }
      return { affectedRows: 1 }
    }
  }
}

const input = { deploymentId: 11, tenantCode: 'C000001', appCode: 'console' }

test('migrated Console license omits Vault data and leaves the customer-held row untouched', async () => {
  const mod = vaultModule()
  const db = executor({ id: 7, secret_value: 'sha256:customer-fingerprint', status: 'migrated' })
  const custody = await mod.resolveConsoleVaultMasterKeyForIssuance({ ...input, executor: db })
  assert.deepEqual(JSON.parse(JSON.stringify(custody)), { mode: 'customer-held' })
  assert.equal(mod.consoleVaultLicenseMetadata(custody), null)
  const payload = licensePayload({ licenseCode: 'L1', tenantCode: 'C000001', planCode: 'enterprise-full', appCode: 'console', deploymentId: 11, deploymentCode: 'C000001-test-console', issuedAt: '2026-09-29', vault: mod.consoleVaultLicenseMetadata(custody) })
  assert.equal('vault' in payload, false)
  assert.doesNotMatch(JSON.stringify(payload), /sha256:customer-fingerprint|masterKeyFingerprint|secret_value/)
  assert.equal(db.writes, 0)
  assert.equal(db.row?.status, 'migrated')
  await assert.rejects(mod.ensureConsoleVaultMasterKey({ ...input, executor: db }), { statusCode: 409 })
})

test('active Platform-held key preserves license fingerprint and does not change storage', async () => {
  const mod = vaultModule()
  const key = Buffer.alloc(32, 7).toString('base64')
  const db = executor({ id: 8, secret_value: key, status: 'active' })
  const custody = await mod.resolveConsoleVaultMasterKeyForIssuance({ ...input, executor: db })
  assert.equal(custody.mode, 'platform-held')
  assert.equal(custody.key, key)
  assert.deepEqual(JSON.parse(JSON.stringify(mod.consoleVaultLicenseMetadata(custody))), {
    masterKeyRequired: true,
    masterKeyFingerprint: mod.fingerprintConsoleVaultMasterKey(key),
    algorithm: 'aes-256-gcm'
  })
  assert.equal('vault' in licensePayload({ licenseCode: 'L1', tenantCode: 'C000001', planCode: 'enterprise-full', appCode: 'console', deploymentId: 11, deploymentCode: 'C000001-test-console', issuedAt: '2026-09-29', vault: mod.consoleVaultLicenseMetadata(custody) }), true)
  assert.equal(db.writes, 0)
})

test('new deployment generates exactly one active key and retains existing license shape', async () => {
  const mod = vaultModule()
  const db = executor(null)
  const custody = await mod.resolveConsoleVaultMasterKeyForIssuance({ ...input, executor: db })
  assert.equal(custody.mode, 'platform-held')
  assert.equal(Buffer.from(custody.key, 'base64').length, 32)
  assert.equal(db.writes, 1)
  assert.equal(db.row?.status, 'active')
  assert.equal(mod.consoleVaultLicenseMetadata(custody).masterKeyFingerprint, mod.fingerprintConsoleVaultMasterKey(custody.key))
})

test('all four issuance paths use custody helper and artifacts never carry the master key', () => {
  for (const path of [
    'server/api/platform/_handlers/licenses.post.ts',
    'server/api/platform/_handlers/subscriptions.post.ts',
    'server/utils/enterpriseProvisioning.ts',
    'server/utils/onboardingFlow.ts'
  ]) {
    const code = source(path)
    assert.match(code, /resolveConsoleVaultMasterKeyForIssuance\(/, path)
    assert.match(code, /consoleVaultLicenseMetadata\(/, path)
    assert.doesNotMatch(code, /ensureConsoleVaultMasterKey\(/, path)
  }
  assert.doesNotMatch(source('server/utils/licenseArtifacts.ts'), /HZY_CONSOLE_VAULT_MASTER_KEY/)
  assert.doesNotMatch(source('server/utils/onboardingFlow.ts'), /`HZY_CONSOLE_VAULT_MASTER_KEY=/)
})
