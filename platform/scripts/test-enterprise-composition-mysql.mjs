import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import mysql from 'mysql2/promise'
import { registerHooks } from 'node:module'
import { statSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'
import { registerEnterpriseNuxtTestHost } from './support/enterprise-nuxt-test-host.mjs'
import { composeManifest } from '../../enterprise/scripts/manifest-artifacts.mjs'

const rootDir = resolve(import.meta.dirname, '../..')
const plan = await buildTemporaryMySqlPlan({ rootDir })
await withTemporaryMySql(plan, async (context) => {
  const connection = context.connection('console')
  const pool = mysql.createPool({ ...connection, timezone: 'Z', dateStrings: true, multipleStatements: true })
  const previousConfig = globalThis.useRuntimeConfig
  globalThis.useRuntimeConfig = () => ({ db: { ...connection, name: connection.database } })
  const hooks = registerEnterpriseNuxtTestHost(rootDir)
  const directoryHook = registerHooks({ resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context)
    if (result.url.startsWith('file:')) {
      const path = fileURLToPath(result.url)
      if (statSync(path).isDirectory()) {
        const entry = ['index.ts', 'index.js'].map(name => resolve(path, name)).find(existsSync)
        if (entry) return { ...result, url: pathToFileURL(entry).href }
      }
    }
    return result
  } })
  let db
  try {
    const ddl = await readFile(resolve(rootDir, 'platform/docs/sql/HZY-Platform-SQL-DDL-Draft-v2.sql'), 'utf8')
    const definitions = [...ddl.matchAll(/CREATE TABLE IF NOT EXISTS `([^`]+)`[\s\S]*?ENGINE=InnoDB[^;]*;/g)]
    assert.ok(definitions.length > 20, 'load actual repository DDL')
    const setup = await pool.getConnection()
    try {
      await setup.query('SET FOREIGN_KEY_CHECKS=0')
      for (const definition of definitions) await setup.query(definition[0])
      await setup.query('SET FOREIGN_KEY_CHECKS=1')
    } finally { setup.release() }
    await pool.query('INSERT INTO platform_applications (app_code,app_name,app_type) VALUES (\'enterprise\',\'Enterprise\',\'business\'),(\'aims\',\'Aims\',\'business\'),(\'assets\',\'Assets\',\'business\')')
    const { registerAppManifest } = await import('../server/utils/appManifests.ts')
    db = await import('../server/utils/db.ts')
    const modules = await Promise.all(['aims', 'assets'].map(async name => JSON.parse(await readFile(resolve(rootDir, name, 'app.manifest.json'), 'utf8'))))
    const manifest = composeManifest(modules)
    const input = { appCode: 'enterprise', releaseVersion: 'enterprise/v0.0.1-test', manifestJson: manifest, sourceType: 'manual' }
    const rows = async sql => (await pool.query(sql))[0]
    const tracked = ['platform_applications', 'platform_app_manifests', 'platform_app_manifest_registrations', 'platform_app_releases', 'platform_app_manifest_resources', 'platform_app_manifest_resource_actions', 'platform_app_roles', 'platform_app_role_permissions', 'platform_app_role_scopes']
    const assignments = ['tenant_subject_roles', 'tenant_account_roles', 'tenant_role_app_role_maps']
    const snapshot = async () => Object.fromEntries(await Promise.all([...tracked, ...assignments].map(async table => [table, await rows(`SELECT * FROM ${table} ORDER BY id`)])))
    const result = await registerAppManifest(input)
    assert.deepEqual(result.composition.map(item => item.appCode), ['aims', 'assets'])
    assert.equal((await rows('SELECT * FROM platform_app_manifests')).length, 3)
    assert.equal((await rows('SELECT * FROM platform_app_manifest_registrations')).length, 3)
    assert.deepEqual((await rows('SELECT app_code FROM platform_app_releases')).map(row => row.app_code), ['enterprise'])
    for (const module of modules) {
      const resources = await rows(`SELECT resource_code FROM platform_app_manifest_resources WHERE app_code='${module.appCode}' ORDER BY resource_code`)
      assert.deepEqual(resources.map(row => row.resource_code).sort(), module.resources.map(resource => resource.code).sort())
      const roles = await rows(`SELECT role_code FROM platform_app_roles WHERE app_code='${module.appCode}' ORDER BY role_code`)
      assert.deepEqual(roles.map(row => row.role_code).sort(), module.recommendedRoles.map(role => role.code).sort())
    }
    assert.equal((await rows('SELECT * FROM platform_app_manifest_resources WHERE app_code=\'enterprise\'')).length, 0)
    assert.equal((await rows('SELECT * FROM platform_app_roles WHERE app_code=\'enterprise\'')).length, 0)
    assert.equal((await rows('SELECT p.id FROM platform_app_role_permissions p JOIN platform_app_roles r ON r.id=p.app_role_id WHERE p.app_code<>r.app_code')).length, 0)
    for (const table of assignments) assert.equal((await rows(`SELECT * FROM ${table}`)).length, 0, `${table}: no personnel grants`)
    const repeated = await registerAppManifest(input)
    assert.equal(repeated.manifest.id, result.manifest.id)
    assert.equal(repeated.release.id, result.release.id)
    assert.deepEqual(repeated.composition, result.composition)
    assert.equal((await rows('SELECT * FROM platform_app_manifests')).length, 3)
    assert.equal((await rows('SELECT * FROM platform_app_manifest_registrations')).length, 6)
    await pool.query('UPDATE platform_app_releases SET status=\'released\' WHERE app_code=\'enterprise\'')
    const beforeConflict = await snapshot()
    const changed = structuredClone(modules)
    for (const module of changed) module.description = `${module.description || ''} changed for rollback test`
    await assert.rejects(registerAppManifest({ ...input, manifestJson: composeManifest(changed) }), error => error.statusCode === 409 && /already released/.test(error.message))
    assert.deepEqual(await snapshot(), beforeConflict, 'released Host conflict rolls back both module snapshots, catalogs, roles and receipts')
    const invalid = structuredClone(changed)
    const role = invalid.find(module => module.appCode === 'assets').recommendedRoles.find(item => item.suggestedPermissions?.length)
    assert.ok(role, 'real Assets role has suggested permissions')
    role.suggestedPermissions.push(structuredClone(role.suggestedPermissions[0]))
    await assert.rejects(registerAppManifest({ ...input, releaseVersion: 'enterprise/v0.0.2-test', manifestJson: composeManifest(invalid) }), error => error.statusCode === 409 && /duplicate/i.test(error.message))
    assert.deepEqual(await snapshot(), beforeConflict, 'second module validation failure rolls back first module and all registration state')
    console.log('Enterprise composition MySQL: real registration, original module catalogs/roles, no personnel grants, snapshot reuse, Host-only release and complete rollback passed.')
  } catch (error) {
    console.error(error)
    throw error
  } finally {
    if (db) await db.useDbPool().end()
    await pool.end()
    globalThis.useRuntimeConfig = previousConfig
    directoryHook.deregister()
    hooks.deregister()
  }
}, { execute: true, confirm: plan.confirmationSha256 })
