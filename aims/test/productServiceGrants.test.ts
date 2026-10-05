import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

test('product service grant artifacts match their generator and declared capabilities', () => {
  execFileSync(process.execPath, [new URL('../scripts/generate-product-center-grants.mjs', import.meta.url).pathname, '--check'])
  const seed = readFileSync(new URL('../../console/docs/sql/Console-SQL-Seed-product-center-20260907.sql', import.meta.url), 'utf8')
  const verify = readFileSync(new URL('../../console/docs/sql/Console-SQL-Verify-product-center-20260907.sql', import.meta.url), 'utf8')
  assert.ok(seed.includes("'assets' app_code, 'codocs' audience, 'codocs:product-document' resource_code, 'read' action"))
  for (const audience of ['data-runtime', 'tenant-runtime']) {
    for (const action of ['authorization-object', 'view', 'edit', 'onboard', 'archive', 'restore', 'admin']) {
      const fragment = `'${audience}:aims:products' resource_code, '${action}' action`
      assert.ok(seed.includes(fragment))
      assert.ok(verify.includes(fragment))
    }
    assert.ok(seed.includes(`'${audience}:assets:product' resource_code, 'read' action`))
    const metadata = `'codocs' app_code, '${audience}' audience, '${audience}:codocs:product-document' resource_code, 'read' action, 1 install_grant`
    assert.ok(seed.includes(metadata))
    assert.ok(verify.includes(metadata))
    assert.ok(verify.includes(`'codocs' app_code, '${audience}' audience, '${audience}:codocs' resource_code, 'read' action, 0 install_grant`))
  }
  assert.ok(seed.includes('\'aims\' app_code, \'codocs\' audience, \'codocs:product-document\' resource_code, \'read\' action'))
  assert.match(seed, /COUNT\(\*\)=5/)
  assert.match(seed, /JOIN pc_grant_guard guard_row ON guard_row.passed=1/)
  assert.match(verify, /LEFT JOIN service_clients/)
  assert.match(verify, /current credential/)
})

test('product BFF service scopes are declared by the Aims manifest', async () => {
  const { readdir } = await import('node:fs/promises')
  const manifest = JSON.parse(readFileSync(new URL('../app.manifest.json', import.meta.url), 'utf8'))
  const declared = new Set<string>()
  for (const resource of manifest.resources) {
    for (const action of resource.actions) declared.add(`aims:${resource.code}:${action}`)
  }
  const root = new URL('../server/api/v1/products/', import.meta.url)
  let checked = 0
  for (const file of await readdir(root, { recursive: true })) {
    if (!file.endsWith('.ts')) continue
    const source = readFileSync(new URL(file, root), 'utf8')
    for (const match of source.matchAll(/scope:\s*'([^']+)'/g)) {
      for (const scope of match[1]!.split(/\s+/)) {
        if (!scope.startsWith('aims:')) continue
        assert.ok(declared.has(scope), `${file}: undeclared service capability ${scope}`)
        checked++
      }
    }
  }
  assert.ok(checked > 0, 'no product BFF service scopes checked')
})

test('product document creation grants cover both trust boundaries with explicit write prerequisites', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../codocs/app.manifest.json', import.meta.url), 'utf8'))
  const resource = manifest.resources.find((item: { code: string }) => item.code === 'product-document')
  assert.ok(resource.actions.includes('create'))
  for (const file of ['Seed', 'Verify']) {
    const sql = readFileSync(new URL(`../../console/docs/sql/Console-SQL-${file}-product-center-20260907.sql`, import.meta.url), 'utf8')
    assert.match(sql, /'aims' app_code, 'codocs' audience, 'codocs:product-document' resource_code, 'create' action/)
    for (const audience of ['data-runtime', 'tenant-runtime']) {
      assert.ok(sql.includes(`'codocs' app_code, '${audience}' audience, '${audience}:codocs:product-document' resource_code, 'create' action, 1 install_grant`))
      assert.ok(sql.includes(`'codocs' app_code, '${audience}' audience, '${audience}:codocs' resource_code, 'write' action, 0 install_grant`))
    }
  }
})

test('product creation worker installs exact execution scope for both runtime audiences without user role grants', () => {
  const manifest = JSON.parse(readFileSync(new URL('../app.manifest.json', import.meta.url), 'utf8'))
  assert.ok(manifest.resources.some((row: { code: string, actions: string[] }) => row.code === 'integration_operation' && row.actions.includes('execute')))
  assert.ok(!JSON.stringify(manifest.recommendedRoles).includes('aims:integration_operation:execute'))
  for (const file of ['Seed', 'Verify']) {
    const sql = readFileSync(new URL(`../../console/docs/sql/Console-SQL-${file}-product-center-20260907.sql`, import.meta.url), 'utf8')
    for (const audience of ['data-runtime', 'tenant-runtime']) assert.ok(sql.includes(`'aims' app_code, '${audience}' audience, '${audience}:aims:integration_operation' resource_code, 'execute' action, 1 install_grant`))
  }
})

test('feedback grants cover Altoc to AIMS and both target runtime audiences', () => {
  for (const file of ['Seed', 'Verify']) {
    const sql = readFileSync(new URL(`../../console/docs/sql/Console-SQL-${file}-product-center-20260907.sql`, import.meta.url), 'utf8')
    assert.ok(sql.includes("'altoc' app_code, 'aims' audience, 'aims:product-request' resource_code, 'create-from-feedback' action, 1 install_grant"))
    for (const audience of ['data-runtime', 'tenant-runtime']) assert.ok(sql.includes(`'aims' app_code, '${audience}' audience, '${audience}:aims:product-request' resource_code, 'create-from-feedback' action, 1 install_grant`))
    assert.ok(sql.includes("COALESCE(@pc_altoc_client_code, 'altoc.runtime')"))
  }
})

test('Altoc feedback worker and source submission have exact dual runtime grants', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../altoc/app.manifest.json', import.meta.url), 'utf8'))
  assert.ok(manifest.resources.some((item: { code: string, actions: string[] }) => item.code === 'integration_operation' && item.actions.includes('execute')))
  assert.ok(!JSON.stringify(manifest.recommendedRoles).includes('altoc:integration_operation:execute'))
  for (const file of ['Seed', 'Verify']) {
    const sql = readFileSync(new URL(`../../console/docs/sql/Console-SQL-${file}-product-center-20260907.sql`, import.meta.url), 'utf8')
    for (const audience of ['data-runtime', 'tenant-runtime']) {
      for (const [resource, action] of [['integration_operation', 'execute'], ['service_ticket', 'edit']]) {
        assert.ok(sql.includes(`'altoc' app_code, '${audience}' audience, '${audience}:altoc:${resource}' resource_code, '${action}' action, 1 install_grant`))
      }
      for (const action of ['read', 'write']) assert.ok(sql.includes(`'altoc' app_code, '${audience}' audience, '${audience}:altoc' resource_code, '${action}' action, 0 install_grant`))
    }
  }
})

test('product decision return scopes stay service-only across both boundaries', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../altoc/app.manifest.json', import.meta.url), 'utf8'))
  assert.ok(manifest.resources.some((item: { code: string, actions: string[] }) => item.code === 'product-feedback' && item.actions.includes('update-status')))
  assert.ok(!JSON.stringify(manifest.recommendedRoles).includes('altoc:product-feedback:update-status'))
  for (const file of ['Seed', 'Verify']) {
    const sql = readFileSync(new URL(`../../console/docs/sql/Console-SQL-${file}-product-center-20260907.sql`, import.meta.url), 'utf8')
    assert.ok(sql.includes("'aims' app_code, 'altoc' audience, 'altoc:product-feedback' resource_code, 'update-status' action, 1 install_grant"))
    for (const audience of ['data-runtime', 'tenant-runtime']) assert.ok(sql.includes(`'altoc' app_code, '${audience}' audience, '${audience}:altoc:product-feedback' resource_code, 'update-status' action, 1 install_grant`))
  }
})


test('product adoption grants cover Assets and both runtime audiences without user roles', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../assets/app.manifest.json', import.meta.url), 'utf8'))
  assert.ok(manifest.resources.some((item: { code: string, actions: string[] }) => item.code === 'product-adoption' && item.actions.includes('read')))
  assert.ok(!JSON.stringify(manifest.recommendedRoles).includes('assets:product-adoption:read'))
  for (const file of ['Seed', 'Verify']) {
    const sql = readFileSync(new URL(`../../console/docs/sql/Console-SQL-${file}-product-center-20260907.sql`, import.meta.url), 'utf8')
    assert.ok(sql.includes("'aims' app_code, 'assets' audience, 'assets:product-adoption' resource_code, 'read' action, 1 install_grant"))
    for (const audience of ['data-runtime', 'tenant-runtime']) assert.ok(sql.includes(`'assets' app_code, '${audience}' audience, '${audience}:assets:product-adoption' resource_code, 'read' action, 1 install_grant`))
  }
})


test('delegated subject authorization grants are exact for AIMS and Assets', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../console/app.manifest.json', import.meta.url), 'utf8'))
  assert.ok(manifest.resources.some((item: { code: string, actions: string[] }) => item.code === 'subject-authorization' && item.actions.includes('read')))
  assert.ok(!JSON.stringify(manifest.recommendedRoles).includes('console:subject-authorization:read'))
  for (const file of ['Seed', 'Verify']) {
    const sql = readFileSync(new URL(`../../console/docs/sql/Console-SQL-${file}-product-center-20260907.sql`, import.meta.url), 'utf8')
    for (const app of ['aims', 'assets']) assert.ok(sql.includes(`'${app}' app_code, 'console' audience, 'console:subject-authorization' resource_code, 'read' action, 1 install_grant`))
  }
})

test('product cost rule writes require exact Finance capability on both runtime audiences', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../finance/app.manifest.json', import.meta.url), 'utf8'))
  assert.ok(manifest.resources.find((row: { code: string }) => row.code === 'product-cost').actions.includes('replace-rules'))
  assert.ok(!JSON.stringify(manifest.recommendedRoles).includes('finance:product-cost:replace-rules'))
  for (const file of ['Seed', 'Verify']) {
    const sql = readFileSync(new URL(`../../console/docs/sql/Console-SQL-${file}-product-center-20260907.sql`, import.meta.url), 'utf8')
    assert.ok(sql.includes("'finance' audience, 'finance:product-cost' resource_code, 'replace-rules' action, 1 install_grant"))
    for (const audience of ['data-runtime', 'tenant-runtime']) {
      assert.ok(sql.includes(`'${audience}:finance:product-cost' resource_code, 'replace-rules' action, 1 install_grant`))
      assert.ok(sql.includes(`'${audience}:finance' resource_code, 'write' action, 0 install_grant`))
    }
  }
})
