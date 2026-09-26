import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'
import { applyRegistration, verifyRegistration, registrationPlan, registrationGrants } from './enterprise-registration.mjs'
const mysql = createRequire(new URL('../../platform/package.json', import.meta.url))('mysql2/promise')
const rootDir = resolve(import.meta.dirname, '../..')
const plan = await buildTemporaryMySqlPlan({ rootDir })
await withTemporaryMySql(plan, async context => {
  const db = await mysql.createConnection(context.connection('console'))
  try {
    const ddl = readFileSync(resolve(rootDir,'console/docs/sql/Console-SQL-DDL-Draft-v1.sql'),'utf8')
    for (const table of ['service_clients','service_client_grants','auth_clients','auth_client_redirect_uris']) {
      const definition = [...ddl.matchAll(/CREATE TABLE IF NOT EXISTS `([^`]+)`[\s\S]*?ENGINE=InnoDB[^;]*;/g)].find(match=>match[1]===table)
      assert.ok(definition);await db.query(definition[0])
    }
    await applyRegistration(db)
    await applyRegistration(db)
    const status = await verifyRegistration(db)
    assert.equal(status.callbackRegistered,true)
    assert.equal(status.logoutRegistered,true)
    assert.deepEqual(status.missingCapabilities,[])
    assert.equal(status.currentCredentialPointer,false)
    const [[count]]=await db.query('SELECT COUNT(*) AS n FROM service_client_grants')
    assert.equal(count.n,registrationGrants.length)
    assert.equal(registrationPlan.capabilities.includes('codocs:product-document:read'),false)
    const [[external]]=await db.query("SELECT JSON_UNQUOTE(JSON_EXTRACT(scope_json,'$.audience')) AS audience FROM service_client_grants WHERE resource_code='codocs:product-document' AND action='read'")
    assert.equal(external.audience,'codocs')
    await db.query("UPDATE service_client_grants SET scope_json=JSON_SET(scope_json,'$.audience','data-runtime') WHERE resource_code='codocs:product-document'")
    assert.deepEqual((await verifyRegistration(db)).missingCapabilities,['codocs:product-document:read'])
    await assert.rejects(()=>applyRegistration(db),/GRANT_AUDIENCE_CONFLICT/)
    await db.query("UPDATE service_client_grants SET scope_json=JSON_SET(scope_json,'$.audience','codocs') WHERE resource_code='codocs:product-document'")
    await db.query("UPDATE service_client_grants SET status='inactive' WHERE resource_code='codocs:product-document'")
    await db.query("DELETE FROM auth_client_redirect_uris WHERE uri_type='post_logout'")
    await assert.rejects(()=>applyRegistration(db),/GRANT_REVOKED/)
    assert.equal((await verifyRegistration(db)).logoutRegistered,false)
    await db.query("UPDATE service_client_grants SET status='active' WHERE resource_code='codocs:product-document'")
    await applyRegistration(db)
    for (const [column, invalid, expected] of [['client_type','confidential','public'], ['auth_mode','legacy','oidc']]) {
      await db.query(`UPDATE auth_clients SET ${column}=? WHERE client_id='enterprise'`, [invalid])
      assert.equal((await verifyRegistration(db)).oidcRegistered,false)
      await assert.rejects(()=>applyRegistration(db), /OIDC_STATE_CONFLICT/)
      const [[unchanged]]=await db.query(`SELECT ${column} AS value FROM auth_clients WHERE client_id='enterprise'`)
      assert.equal(unchanged.value,invalid)
      await db.query(`UPDATE auth_clients SET ${column}=? WHERE client_id='enterprise'`, [expected])
    }
    await db.query("UPDATE service_client_grants SET scope_json=JSON_SET(JSON_REMOVE(scope_json,'$.audience','$.semanticScope'),'$.operatorNote','retain-me')")
    assert.equal((await verifyRegistration(db)).missingCapabilities.length,registrationGrants.length)
    await applyRegistration(db)
    assert.deepEqual((await verifyRegistration(db)).missingCapabilities,[])
    const [[metadata]]=await db.query("SELECT COUNT(*) AS n FROM service_client_grants WHERE JSON_UNQUOTE(JSON_EXTRACT(scope_json,'$.operatorNote'))='retain-me'")
    assert.equal(metadata.n,registrationGrants.length)
    await db.query("UPDATE service_client_grants SET scope_json=JSON_SET(scope_json,'$.audience','other') WHERE resource_code='aims:products' AND action='view'")
    await assert.rejects(()=>applyRegistration(db),/GRANT_AUDIENCE_CONFLICT/)
    await db.query("UPDATE service_client_grants SET scope_json=JSON_SET(scope_json,'$.audience','data-runtime') WHERE resource_code='aims:products' AND action='view'")
    assert.equal((await verifyRegistration(db)).oidcRegistered,true)
    // Revocation is preserved; an attempted install must roll back even earlier URI work.
    await db.query("UPDATE service_client_grants SET status='inactive' WHERE action='view'")
    await db.query("DELETE FROM auth_client_redirect_uris WHERE uri_type='post_logout'")
    await assert.rejects(()=>applyRegistration(db), /GRANT_REVOKED/)
    assert.equal((await verifyRegistration(db)).logoutRegistered,false)
    const [[grant]]=await db.query("SELECT status FROM service_client_grants WHERE action='view'")
    assert.equal(grant.status,'inactive')
    console.log('Enterprise registration: actual Console DDL, replay, exact grants, no credential and atomic revocation rollback passed')
  } finally { await db.end() }
}, { execute: true, confirm: plan.confirmationSha256 })
