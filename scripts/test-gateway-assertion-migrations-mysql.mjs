import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import mysql from 'mysql2/promise'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from './test/support/temporary-mysql-harness.mjs'
import { migrationSource, inspectGatewaySchema, schemaHashes, planGatewayMigration, applyGatewayMigration, verifyGatewayMigration } from './gateway-assertion-migration.mjs'

const rootDir = resolve(import.meta.dirname, '..')
const plan = await buildTemporaryMySqlPlan({ rootDir })
await withTemporaryMySql(plan, async (context) => {
  assert.match(context.socketPath, /^\/tmp\/hzy-test-mysql-/)
  const root = await mysql.createConnection({ socketPath: context.socketPath, user: 'root' })
  const database = 'gateway_migration_fixture'
  await root.query(`CREATE DATABASE ${database}`)
  const db = await mysql.createConnection({ socketPath: context.socketPath, user: 'root', database, multipleStatements: true })
  try {
    await db.query('CREATE TABLE deployment_sites (id BIGINT UNSIGNED PRIMARY KEY,site_code VARCHAR(128) NOT NULL UNIQUE,tenant_code VARCHAR(64) NOT NULL,environment VARCHAR(32) NOT NULL,status VARCHAR(32) NOT NULL,public_url VARCHAR(512) NOT NULL) ENGINE=InnoDB')
    await db.query("INSERT INTO deployment_sites VALUES (1,'test-gateway','C-TEST','test','active','https://tenant.test'),(2,'other-gateway','C-OTHER','test','active','https://other.test')")
    await db.query("CREATE TABLE business_sentinel (id INT PRIMARY KEY,value VARCHAR(30)); INSERT INTO business_sentinel VALUES(1,'unchanged')")
    const [[identity]] = await db.query('SELECT @@server_uuid AS serverUuid')
    const binding = { database, serverUuid: identity.serverUuid, tenant: 'C-TEST', environment: 'test', gatewayDeployment: 'test-gateway', runtimeCode: 'test-runtime', consoleDeployment: 'test-console' }
    // Build reference fingerprints ONLY inside the disposable server from the
    // reviewed sources; no environment is inspected or modified by this test.
    const expected = {}
    for (const target of ['platform', 'runtime']) {
      const source = await migrationSource(target)
      await db.query(source.sql)
      expected[target] = schemaHashes(await inspectGatewaySchema(db, target))
      const canonical = await readFile(resolve(rootDir, target === 'platform' ? 'platform/docs/sql/HZY-Platform-SQL-DDL-Draft-v2.sql' : 'console/docs/sql/Console-SQL-DDL-Draft-v1.sql'), 'utf8')
      assert.ok(canonical.endsWith(source.sql), `${target} canonical DDL must include the exact migration`)
      if (target === 'runtime') assert.ok((await readFile(resolve(rootDir, 'console/docs/hzy_console_schema.sql'), 'utf8')).endsWith(source.sql))
      for (const table of [...source.tables].reverse()) await db.query(`DROP TABLE ${table}`)
    }
    const backup = await mkdtemp(join(context.rootDir, 'gateway-backup-'))
    for (const target of ['platform', 'runtime']) {
      let beforePlan = await planGatewayMigration(db, target, binding, expected[target])
      assert.ok(Object.values(beforePlan.before).every(value => value === null))
      assert.equal(beforePlan.mutationsPerformed, false)
      await assert.rejects(applyGatewayMigration(db, target, binding, expected[target], 'wrong-review-hash', backup), /REVIEW_HASH_MISMATCH/)
      assert.ok(Object.values(schemaHashes(await inspectGatewaySchema(db, target))).every(value => value === null))
      await assert.rejects(planGatewayMigration(db, target, { ...binding, environment: 'prod' }, expected[target]), /BINDING_MISMATCH/)
      await assert.rejects(planGatewayMigration(db, target, { ...binding, serverUuid: 'other' }, expected[target]), /BINDING_MISMATCH/)
      if (target === 'platform') await assert.rejects(planGatewayMigration(db, target, { ...binding, gatewayDeployment: 'other-gateway' }, expected[target]), /DEPLOYMENT_MISMATCH/)
      if (target === 'platform') {
        // Interrupted nontransactional DDL: the first table was created, not
        // the second. Stale plan is rejected; new exact plan safely resumes.
        await db.query((await migrationSource(target)).sql.match(/CREATE TABLE IF NOT EXISTS[\s\S]*?ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;/)[0])
        await assert.rejects(applyGatewayMigration(db, target, binding, expected[target], beforePlan.reviewHash, backup), /REVIEW_HASH_MISMATCH/)
        beforePlan = await planGatewayMigration(db, target, binding, expected[target])
        assert.notEqual(beforePlan.before.platform_gateway_keysets, null)
        assert.equal(beforePlan.before.platform_gateway_service_keys, null)
      }
      const receipt = await applyGatewayMigration(db, target, binding, expected[target], beforePlan.reviewHash, backup)
      assert.equal(receipt.businessRowsMutated, false)
      assert.equal(receipt.mutationsPerformed, true)
      assert.equal(receipt.verified, true)
      assert.equal((await stat(join(backup, beforePlan.reviewHash, 'before.json'))).mode & 0o777, 0o600)
      const repeatPlan = await planGatewayMigration(db, target, binding, expected[target])
      await applyGatewayMigration(db, target, binding, expected[target], repeatPlan.reviewHash, backup)
      await verifyGatewayMigration(db, target, expected[target])
    }
    // Registry constraints: deployment existence, two rotation slots, validity,
    // binary key identity, and history retained after revocation.
    await assert.rejects(db.query("INSERT INTO platform_gateway_keysets(site_id,gateway_site_code,tenant_code,environment) VALUES(999,'unknown','C-TEST','test')"), { code: 'ER_NO_REFERENCED_ROW_2' })
    await db.query("INSERT INTO platform_gateway_keysets(site_id,gateway_site_code,tenant_code,environment) VALUES(1,'test-gateway','C-TEST','test'),(2,'other-gateway','C-OTHER','test')")
    const key = (id, kid, slot, status = 'next', revoked = null, end = 2000) => db.query('INSERT INTO platform_gateway_service_keys(site_id,kid,public_key,rotation_slot,status,not_before,not_after,registered_by,revoked_at) VALUES(?,?,?,?,?,1000,?,?,?)', [id,kid,'A'.repeat(43),slot,status,end,'staff-fixture',revoked])
    await key(1,'a'.repeat(64),1)
    await key(1,'b'.repeat(64),2,'active')
    await assert.rejects(key(1,'c'.repeat(64),1), { code: 'ER_DUP_ENTRY' })
    await assert.rejects(key(1,'c'.repeat(64),3))
    await assert.rejects(key(2,'d'.repeat(64),1,'next',null,1000))
    await assert.rejects(key(2,'d'.repeat(64),1,'next',null,7776001001))
    await assert.rejects(key(2,'d'.repeat(64),1,'unknown'))
    await assert.rejects(key(2,'d'.repeat(64),1,'revoked'))
    await db.query("UPDATE platform_gateway_service_keys SET status='revoked',revoked_at=UTC_TIMESTAMP(6) WHERE site_id=1 AND kid=?", ['a'.repeat(64)])
    await key(1,'c'.repeat(64),1)
    await assert.rejects(key(1,'a'.repeat(64),1), { code: 'ER_DUP_ENTRY' })
    const [[keys]] = await db.query('SELECT COUNT(*) AS count FROM platform_gateway_service_keys WHERE site_id=1')
    assert.equal(keys.count,3)
    // Replay is case-sensitive, isolated by deployment, and transactional.
    const jti = 'A'.repeat(22)
    const insert = (connection, deployment, value) => connection.query('INSERT INTO gateway_service_assertion_replay(gateway_deployment_code,jti,tenant_code,environment,kid,expires_at) VALUES(?,?,?,?,?,?)', [deployment,value,'C-TEST','test','a'.repeat(64),2000])
    await insert(db,'test-gateway',jti)
    await assert.rejects(insert(db,'test-gateway',jti), { code: 'ER_DUP_ENTRY' })
    await insert(db,'test-gateway',jti.toLowerCase())
    await insert(db,'other-gateway',jti)
    await assert.rejects(insert(db,'test-gateway','short'))
    await db.beginTransaction()
    await insert(db,'test-gateway','B'.repeat(22))
    await db.rollback()
    await insert(db,'test-gateway','B'.repeat(22))
    const second = await mysql.createConnection({ socketPath: context.socketPath, user:'root', database })
    try {
      const concurrent = await Promise.allSettled([insert(db,'test-gateway','C'.repeat(22)),insert(second,'test-gateway','C'.repeat(22))])
      assert.equal(concurrent.filter(r => r.status === 'fulfilled').length,1)
      assert.equal(concurrent.filter(r => r.status === 'rejected' && r.reason.code === 'ER_DUP_ENTRY').length,1)
    } finally { await second.end() }
    const [[sentinel]] = await db.query('SELECT value FROM business_sentinel WHERE id=1')
    assert.equal(sentinel.value,'unchanged')
    for (const target of ['platform', 'runtime']) {
      const snapshots = {}
      for (const table of (await migrationSource(target)).tables) snapshots[table] = (await db.query(`SELECT * FROM ${table} ORDER BY 1,2`))[0]
      const populatedPlan = await planGatewayMigration(db,target,binding,expected[target])
      await applyGatewayMigration(db,target,binding,expected[target],populatedPlan.reviewHash,backup)
      for (const [table, rows] of Object.entries(snapshots)) assert.deepEqual((await db.query(`SELECT * FROM ${table} ORDER BY 1,2`))[0],rows)
    }
    await db.query('ALTER TABLE gateway_service_assertion_replay ADD drift INT NULL')
    await assert.rejects(planGatewayMigration(db,'runtime',binding,expected.runtime), /SCHEMA_DRIFT/)
    await assert.rejects(verifyGatewayMigration(db,'runtime',expected.runtime), /POST_VERIFICATION_FAILED/)
    console.log('PASS Gateway migrations: plan/hash/backup/verify, interruption/repeat, existing rows, canonical DDL, constraints, concurrent replay, rollback, drift and business sentinel')
  } finally {
    await db.end()
    await root.query(`DROP DATABASE ${database}`)
    await root.end()
  }
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
