// Candidate SQL validation uses only the disposable MySQL harness, never hzy0.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'
const rootDir = resolve(import.meta.dirname, '../..')
const plan = await buildTemporaryMySqlPlan({ rootDir })
await withTemporaryMySql(plan, async context => {
  function sql(text) {
    const result = spawnSync(context.mysql, ['--protocol=SOCKET', `--socket=${context.socketPath}`, '--user=root', '--database=hzy_console', '--batch', '--skip-column-names'], { input: text, encoding: 'utf8' })
    if (result.status !== 0) throw Error(`Isolated grant SQL failed: ${result.stderr}`)
    return result.stdout.trim()
  }
  const schema = readFileSync(resolve(rootDir, 'console/docs/hzy_console_schema.sql'), 'utf8')
  for (const table of ['service_clients', 'service_client_grants']) {
    const ddl = schema.match(new RegExp('CREATE TABLE IF NOT EXISTS `'+table+'`[\\s\\S]*?;'))?.[0]
    assert.ok(ddl, `missing canonical DDL: ${table}`)
    sql(ddl)
  }
  const seed = readFileSync(resolve(rootDir, 'console/docs/sql/Console-SQL-Seed-aims-host-r1-candidate.sql'), 'utf8')
  const verify = readFileSync(resolve(rootDir, 'console/docs/sql/Console-SQL-Verify-aims-host-r1-candidate.sql'), 'utf8')
  const variables = "SET @r1_tenant='fixture-tenant', @r1_enterprise_deployment='fixture-host';"
  sql("INSERT INTO service_clients(client_code,client_name,app_code,status) VALUES('enterprise.runtime','fixture','enterprise','active');")
  assert.equal(sql(variables + seed), '11')
  assert.equal(sql(variables + seed), '0')
  const output = sql(variables + verify).split('\n')
  assert.equal(output.length, 12)
  assert.ok(output.slice(0, 11).every(line => line.endsWith('\t1\t1')))
  assert.equal(output[11], '1')
  sql("UPDATE service_client_grants SET resource_code='aims:milestone-rollover',status='revoked' WHERE resource_code='data-runtime:aims:milestone-rollover';")
  assert.ok(sql(variables + verify).split('\n').some(line => line.endsWith('\t0\t1')), 'revoked reviewed alias still fails closed')
  assert.equal(sql(variables + seed), '0', 'seed never bypasses or revives a revoked semantic tuple')
  sql("UPDATE service_client_grants SET status='active' WHERE resource_code='aims:milestone-rollover';")
  assert.ok(sql(variables + verify).split('\n').slice(0, 11).every(line => line.endsWith('\t1\t1')), 'separately restored exact alias is reused')
  assert.equal(sql(variables + seed), '0', 'restored alias cannot produce duplicate grants')
  for (const capability of ['integration_operation', 'milestone-rollover', 'notifications-due']) {
    const physical = capability === 'milestone-rollover' ? `aims:${capability}` : `data-runtime:aims:${capability}`
    sql(`UPDATE service_client_grants SET resource_code='aims:${capability}' WHERE resource_code='${physical}';`)
    assert.ok(sql(variables + verify).split('\n').slice(0, 11).every(line => line.endsWith('\t1\t1')), 'enumerated exact aliases accepted')
    assert.equal(sql(variables + seed), '0')
    for (const mutation of [
      `resource_code='aims:${capability}-other'`,
      "scope_json=JSON_SET(scope_json,'$.audience','workflow')",
      "scope_json=JSON_SET(scope_json,'$.semanticScope','aims:scheduler:execute')"
    ]) {
      sql(`UPDATE service_client_grants SET ${mutation} WHERE resource_code='aims:${capability}';`)
      assert.ok(sql(variables + verify).split('\n').slice(0, 11).some(line => !line.endsWith('\t1\t1')), 'unknown alias/audience/scope rejected')
      sql(`UPDATE service_client_grants SET resource_code='aims:${capability}',scope_json=JSON_SET(scope_json,'$.audience','data-runtime','$.semanticScope','aims:${capability}:execute') WHERE resource_code IN ('aims:${capability}','aims:${capability}-other');`)
    }
    if (capability !== 'milestone-rollover') sql(`UPDATE service_client_grants SET resource_code='${physical}' WHERE resource_code='aims:${capability}';`)
  }
  sql("UPDATE service_client_grants SET scope_json=JSON_SET(scope_json,'$.deploymentCode','wrong') WHERE resource_code='aims:milestone-rollover';")
  assert.ok(sql(variables + verify).split('\n').some(line => line.endsWith('\t0\t1')), 'alias cannot bypass deployment binding')
  assert.equal(sql(variables + seed), '0')
  sql("UPDATE service_client_grants SET scope_json=JSON_SET(scope_json,'$.deploymentCode','fixture-host') WHERE resource_code='aims:milestone-rollover';")
  sql("UPDATE service_client_grants SET scope_json=JSON_SET(scope_json,'$.tenantCode','wrong') WHERE resource_code='data-runtime:aims:integration_operation';")
  assert.ok(sql(variables + verify).split('\n').some(line => line.endsWith('\t0\t1')))
  assert.equal(sql(variables + seed), '0', 'conflicting grants are never repaired')
  sql("UPDATE service_clients SET status='revoked' WHERE client_code='enterprise.runtime';")
  assert.equal(sql(variables + seed), '0', 'revoked client is never revived')
  sql("UPDATE service_clients SET status='active' WHERE client_code='enterprise.runtime';")
  const callbackSeed = readFileSync(resolve(rootDir, 'console/docs/sql/Console-SQL-Seed-aims-host-callback-candidate.sql'), 'utf8')
  const callbackVerify = readFileSync(resolve(rootDir, 'console/docs/sql/Console-SQL-Verify-aims-host-callback-candidate.sql'), 'utf8')
  assert.equal(sql(variables + callbackSeed), '2')
  assert.equal(sql(variables + callbackSeed), '0')
  assert.ok(sql(variables + callbackVerify).split('\n').slice(0, 2).every(line => line.endsWith('\t1\t1')))
  for (const mutation of [
    "status='revoked'",
    "resource_code='aims:scheduler'",
    "scope_json=JSON_SET(scope_json,'$.audience','workflow')",
    "scope_json=JSON_SET(scope_json,'$.tenantCode','wrong')",
    "scope_json=JSON_SET(scope_json,'$.deploymentCode','wrong')",
    "scope_json=JSON_SET(scope_json,'$.semanticScope','aims:integration_operation:execute')"
  ]) {
    sql(`UPDATE service_client_grants SET ${mutation} WHERE resource_code='data-runtime:aims:scheduler';`)
    assert.ok(sql(variables + callbackVerify).split('\n').slice(0, 2).some(line => !line.endsWith('\t1\t1')))
    assert.equal(sql(variables + callbackSeed), '0', 'conflict is never repaired or bypassed')
    sql("UPDATE service_client_grants SET resource_code='data-runtime:aims:scheduler',status='active',scope_json=JSON_OBJECT('audience','data-runtime','semanticScope','aims:scheduler:execute','tenantCode','fixture-tenant','deploymentCode','fixture-host') WHERE resource_code IN ('data-runtime:aims:scheduler','aims:scheduler');")
  }
  console.log('PASS isolated R1 grant candidates: 11 R1 + 2 callback-only exact tuples, repeat no-op, conflict detected/preserved, revoked client unchanged')
}, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
