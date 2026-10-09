import assert from 'node:assert/strict'
import test from 'node:test'
import { registerHooks } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import mysql, { type RowDataPacket, type ResultSetHeader } from 'mysql2/promise'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'

const workspace = resolve(import.meta.dirname, '../..')

test('isolated MySQL: provenance migration, manual collision, omission, clearing and idempotent defaults', async () => {
  const hooks = registerHooks({ resolve(specifier, context, next) {
    let candidate: string | undefined
    if (specifier.startsWith('~~/')) candidate = resolve(workspace, 'platform', specifier.slice(3))
    else if (specifier.startsWith('.') && context.parentURL?.startsWith('file:')) candidate = resolve(dirname(fileURLToPath(context.parentURL)), specifier)
    if (candidate && !existsSync(candidate) && existsSync(candidate + '.ts')) return { url: pathToFileURL(candidate + '.ts').href, shortCircuit: true }
    return next(specifier, context)
  } })
  try {
    const { materializeRecommendedRolesFromManifest } = await import('../server/utils/appManifestRoles.ts')
    const { replaceSystemRoleScopes } = await import('../server/utils/systemRoleGovernance.ts')
    const plan = await buildTemporaryMySqlPlan({ rootDir: workspace })
    let executed = false
    await withTemporaryMySql(plan, async (context: { socketPath: string }) => {
      executed = true
      const conn = await mysql.createConnection({ socketPath: context.socketPath, user: 'root' })
      try {
        await conn.query('CREATE DATABASE default_scope_test')
        await conn.query('USE default_scope_test')
        await conn.query(`CREATE TABLE platform_app_roles (
          id BIGINT PRIMARY KEY AUTO_INCREMENT,role_code VARCHAR(128) UNIQUE,role_name VARCHAR(128),role_type VARCHAR(32),app_code VARCHAR(64),description TEXT,
          is_required INT,status VARCHAR(32),policy_hash VARCHAR(100),policy_revision BIGINT DEFAULT 0,policy_updated_at DATETIME,created_at DATETIME,updated_at DATETIME)`)
        await conn.query(`CREATE TABLE platform_app_manifest_resource_actions (id BIGINT PRIMARY KEY,manifest_id BIGINT,manifest_resource_id BIGINT,app_code VARCHAR(64),resource_code VARCHAR(128),action VARCHAR(32),status VARCHAR(32))`)
        await conn.query(`CREATE TABLE platform_app_manifest_resources (id BIGINT PRIMARY KEY,manifest_id BIGINT,app_code VARCHAR(64),resource_code VARCHAR(128),status VARCHAR(32))`)
        await conn.query(`CREATE TABLE platform_app_role_permissions (app_role_id BIGINT,app_code VARCHAR(64),resource_code VARCHAR(128),action VARCHAR(32),manifest_action_id BIGINT,created_at DATETIME)`)
        await conn.query(`CREATE TABLE platform_app_role_scopes (id BIGINT PRIMARY KEY AUTO_INCREMENT,app_role_id BIGINT,app_code VARCHAR(64),resource_code VARCHAR(128),action VARCHAR(32),manifest_action_id BIGINT,scope_type VARCHAR(32),scope_value VARCHAR(255),status VARCHAR(32),created_at DATETIME,updated_at DATETIME,
          UNIQUE KEY tuples(app_role_id,app_code,resource_code,action,scope_type,scope_value))`)
        await conn.query('INSERT INTO platform_app_manifest_resources VALUES (1,1,\'finance\',\'expenses\',\'active\')')
        await conn.query('INSERT INTO platform_app_manifest_resource_actions VALUES (10,1,1,\'finance\',\'expenses\',\'view\',\'active\'),(11,1,1,\'finance\',\'expenses\',\'edit\',\'active\')')
        const executor = {
          queryRow: async <T extends RowDataPacket>(sql: string, params: unknown[] = []) => {
            const [rows] = await conn.query<T[]>(sql, params)
            return rows[0] || null
          },
          queryRows: async <T extends RowDataPacket[]>(sql: string, params: unknown[] = []) => {
            const [rows] = await conn.query<T>(sql, params)
            return rows
          },
          execute: async <T extends ResultSetHeader>(sql: string, params: unknown[] = []) => {
            const [result] = await conn.execute<T>(sql, params)
            return result
          }
        }
        const role = { code: 'finance:admin', suggestedPermissions: ['finance:expenses:view', 'finance:expenses:edit'], defaultScopes: ['tenant:global'] as unknown }
        const manifest = { supportedScopes: ['tenant:global', 'subject:self'], recommendedRoles: [role] }
        const sync = () => materializeRecommendedRolesFromManifest(executor, { appCode: 'finance', manifestId: 1, manifestJson: manifest })
        await assert.rejects(sync(), error => (error as { statusCode: number }).statusCode === 503 && /source_type migration/.test(String(error)))
        assert.equal((await executor.queryRows<RowDataPacket[]>('SELECT * FROM platform_app_roles')).length, 0, 'migration guard precedes every write')
        const migration = readFileSync(new URL('../docs/sql/HZY-Platform-SQL-Migration-finance-manifest-default-scopes-candidate.sql', import.meta.url), 'utf8')
        await conn.query(migration)
        await sync()
        const snapshot = () => executor.queryRows<RowDataPacket[]>('SELECT id,app_role_id,resource_code,action,scope_type,scope_value,source_type,status FROM platform_app_role_scopes ORDER BY id')
        const first = await snapshot()
        assert.equal(first.length, 2)
        assert.ok(first.every(row => row.source_type === 'manifest_default'))
        const revision = await executor.queryRow<RowDataPacket>('SELECT policy_revision FROM platform_app_roles WHERE id=1')
        await sync()
        assert.deepEqual(await snapshot(), first, 'repeat preserves scope IDs and content')
        assert.deepEqual(await executor.queryRow<RowDataPacket>('SELECT policy_revision FROM platform_app_roles WHERE id=1'), revision, 'same policy does not bump revision')
        await conn.query('UPDATE platform_app_role_scopes SET source_type=\'manual\',status=\'inactive\' WHERE action=\'view\'')
        const custom = (await snapshot()).find(row => row.action === 'view')!
        await sync()
        assert.deepEqual((await snapshot()).find(row => row.action === 'view'), custom, 'same-tuple manual row is not reattributed or activated')
        delete (role as { defaultScopes?: unknown }).defaultScopes
        await sync()
        assert.equal((await snapshot()).length, 2, 'omission preserves all existing scopes')
        role.defaultScopes = []
        await sync()
        assert.deepEqual(await snapshot(), [custom], '[] deletes owned defaults only')
        role.defaultScopes = [{ scope: 'subject:self', resourceCode: 'expenses', action: 'edit' }]
        await sync()
        assert.equal((await snapshot()).length, 2)
        assert.ok((await snapshot()).some(row => row.scope_type === 'subject' && row.scope_value === 'self'))
        const before = await snapshot()
        role.defaultScopes = [{ scope: 'tenant:global', resourceCode: 'invoices' }]
        await assert.rejects(sync(), { statusCode: 400 })
        assert.deepEqual(await snapshot(), before, 'invalid undeclared resource performs no mutation')
        await conn.query('DELETE FROM platform_app_role_scopes WHERE source_type=\'manifest_default\'')
        assert.deepEqual(await snapshot(), [custom], 'rollback removes defaults and leaves custom')
        await conn.query('CREATE TABLE platform_applications (app_code VARCHAR(64),latest_release_id BIGINT,latest_manifest_id BIGINT)')
        await conn.query('CREATE TABLE platform_app_manifests (id BIGINT,app_code VARCHAR(64))')
        await conn.query('CREATE TABLE platform_app_releases (id BIGINT,app_code VARCHAR(64),manifest_id BIGINT)')
        await conn.query('INSERT INTO platform_applications VALUES (\'finance\',NULL,1)')
        await conn.query('INSERT INTO platform_app_manifests VALUES (1,\'finance\')')
        await replaceSystemRoleScopes(executor, 1, [{ appCode: 'finance', resourceCode: 'expenses', action: 'view', scopeType: 'tenant', scopeValue: 'global', status: 'active' }])
        assert.equal((await snapshot())[0]?.source_type, 'manual', 'governance editing explicitly writes manual provenance')
      } finally { await conn.end() }
    }, { execute: true, confirm: plan.confirmationSha256, temporaryParent: '/tmp' })
    assert.equal(executed, true, 'the isolated callback must actually run')
  } finally { hooks.deregister() }
})
