import test from 'node:test'
import assert from 'node:assert/strict'
import * as policy from '../server/lib/serviceAuthPolicy'
import { codocsAimsServiceSource, requireCodocsServiceAuth, AIMS_PRODUCT_DOCUMENT_READ_SERVICE_AUTH } from '../server/lib/serviceAuthPolicy'

test('Codocs sources are paired, legacy window does not authorize another client', () => {
  assert.deepEqual(codocsAimsServiceSource({ appCode: 'enterprise', clientCode: 'enterprise.runtime' }, false), { sourceApp: 'enterprise', sourceClientId: 'enterprise.runtime' })
  assert.deepEqual(codocsAimsServiceSource({ appCode: 'aims', clientCode: 'aims.runtime' }, true), { sourceApp: 'aims', sourceClientId: 'aims.runtime' })
  for (const [appCode, clientCode, enabled] of [['aims', 'aims.runtime', false], ['enterprise', 'aims.runtime', true], ['aims', 'enterprise.runtime', true], ['altoc', 'altoc.runtime', true]] as const) {
    assert.throws(() => codocsAimsServiceSource({ appCode, clientCode }, enabled), { statusCode: 403 })
  }
})
test('Enterprise Codocs source still requires exact capability', () => {
  const auth = { authenticated: true, subjectType: 'service', tokenUse: 'service', appCode: 'enterprise', clientCode: 'enterprise.runtime', scopes: ['codocs:product-document:read'] }
  assert.doesNotThrow(() => requireCodocsServiceAuth(auth, AIMS_PRODUCT_DOCUMENT_READ_SERVICE_AUTH))
  assert.throws(() => requireCodocsServiceAuth({ ...auth, scopes: ['codocs:*'] }, AIMS_PRODUCT_DOCUMENT_READ_SERVICE_AUTH), { statusCode: 403 })
})

test('every Aims policy accepts only the paired Enterprise source, exact scope, or explicitly enabled legacy', () => {
  const requirements = Object.entries(policy).filter(([name, value]) => name.startsWith('AIMS_') && typeof value === 'object') as Array<[string, policy.CodocsServiceAuthRequirement]>
  assert.ok(requirements.length >= 12)
  for (const [name, requirement] of requirements) {
    const auth = { authenticated: true, tokenUse: 'service', subjectType: 'service', appCode: 'enterprise', clientCode: 'enterprise.runtime', scopes: [requirement.scope] }
    assert.doesNotThrow(() => requireCodocsServiceAuth(auth, requirement), name)
    assert.throws(() => requireCodocsServiceAuth({ ...auth, appCode: 'altoc', clientCode: 'altoc.runtime' }, requirement), { statusCode: 403 }, name)
    assert.throws(() => requireCodocsServiceAuth({ ...auth, scopes: ['codocs:*'] }, requirement), { statusCode: 403 }, name)
    const previous = process.env.HZY_CODOCS_LEGACY_AIMS_SERVICE_ENABLED
    try {
      process.env.HZY_CODOCS_LEGACY_AIMS_SERVICE_ENABLED = 'false'
      assert.throws(() => requireCodocsServiceAuth({ ...auth, appCode: 'aims', clientCode: 'aims.runtime' }, requirement), { statusCode: 403 }, name)
      process.env.HZY_CODOCS_LEGACY_AIMS_SERVICE_ENABLED = 'true'
      assert.doesNotThrow(() => requireCodocsServiceAuth({ ...auth, appCode: 'aims', clientCode: 'aims.runtime' }, requirement), name)
    } finally {
      if (previous === undefined) delete process.env.HZY_CODOCS_LEGACY_AIMS_SERVICE_ENABLED
      else process.env.HZY_CODOCS_LEGACY_AIMS_SERVICE_ENABLED = previous
    }
  }
})

test('candidate grant seed and verify cover every migrated policy without reviving existing grants', async () => {
  const { readFile } = await import('node:fs/promises')
  const prefix = '../../console/docs/sql/Console-SQL-'
  const seed = await readFile(new URL(`${prefix}Seed-p1-enterprise-codocs-candidate.sql`, import.meta.url), 'utf8')
  const verify = await readFile(new URL(`${prefix}Verify-p1-enterprise-codocs-candidate.sql`, import.meta.url), 'utf8')
  const scopes = new Set(Object.entries(policy).filter(([name, value]) => name.startsWith('AIMS_') && typeof value === 'object').map(([, value]) => (value as policy.CodocsServiceAuthRequirement).scope))
  for (const scope of scopes) {
    assert.ok(seed.includes(`'${scope}' AS semantic_scope`), `missing seed: ${scope}`)
    assert.ok(verify.includes(`'${scope}' AS semantic_scope`), `missing verify: ${scope}`)
  }
  assert.match(seed, /sc\.client_code='enterprise\.runtime' AND sc\.app_code='enterprise' AND sc\.status='active'/)
  assert.match(seed, /NOT EXISTS\(SELECT 1 FROM service_client_grants old WHERE old\.service_client_id=sc\.id AND old\.resource_code=g\.resource AND old\.action=g\.action\)/)
  assert.match(verify, /revoked_requires_separate_approval/)
  assert.doesNotMatch(seed, /(?:UPDATE\s+service_client_grants|ON DUPLICATE KEY UPDATE|DELETE\s+FROM\s+service_client_grants)/i)
  for (const key of ['audience', 'semanticScope', 'tenantCode', 'deploymentCode']) assert.ok(seed.includes(`'${key}'`))
})

test('legacy Aims source defaults on and explicit false withdraws it', () => {
  const previous = process.env.HZY_CODOCS_LEGACY_AIMS_SERVICE_ENABLED
  try {
    delete process.env.HZY_CODOCS_LEGACY_AIMS_SERVICE_ENABLED
    assert.deepEqual(policy.codocsAimsServiceSource({ appCode: 'aims', clientCode: 'aims.runtime' } as never), { sourceApp: 'aims', sourceClientId: 'aims.runtime' })
    process.env.HZY_CODOCS_LEGACY_AIMS_SERVICE_ENABLED = 'false'
    assert.throws(() => policy.codocsAimsServiceSource({ appCode: 'aims', clientCode: 'aims.runtime' } as never), { statusCode: 403 })
    assert.deepEqual(policy.codocsAimsServiceSource({ appCode: 'enterprise', clientCode: 'enterprise.runtime' } as never), { sourceApp: 'enterprise', sourceClientId: 'enterprise.runtime' })
  } finally {
    if (previous === undefined) delete process.env.HZY_CODOCS_LEGACY_AIMS_SERVICE_ENABLED
    else process.env.HZY_CODOCS_LEGACY_AIMS_SERVICE_ENABLED = previous
  }
})

test('legacy retirement observation uses a fixed .legacy audit event without business data', () => {
  const original = console.info
  const previous = process.env.HZY_CODOCS_LEGACY_AIMS_SERVICE_ENABLED
  const records: Array<Record<string, unknown>> = []
  try {
    console.info = line => records.push(JSON.parse(String(line)))
    process.env.HZY_CODOCS_LEGACY_AIMS_SERVICE_ENABLED = 'true'
    for (const appCode of ['aims', 'enterprise']) {
      requireCodocsServiceAuth({ authenticated: true, tokenUse: 'service', subjectType: 'service', appCode, clientCode: `${appCode}.runtime`, scopes: [AIMS_PRODUCT_DOCUMENT_READ_SERVICE_AUTH.scope] }, AIMS_PRODUCT_DOCUMENT_READ_SERVICE_AUTH)
    }
    assert.deepEqual(records.map(record => record.event), ['codocs-service-source.legacy', 'codocs-service-source.enterprise'])
    for (const record of records) assert.deepEqual(Object.keys(record).sort(), ['branch', 'client', 'event', 'scope', 'source'])
  } finally {
    console.info = original
    if (previous === undefined) delete process.env.HZY_CODOCS_LEGACY_AIMS_SERVICE_ENABLED
    else process.env.HZY_CODOCS_LEGACY_AIMS_SERVICE_ENABLED = previous
  }
})
