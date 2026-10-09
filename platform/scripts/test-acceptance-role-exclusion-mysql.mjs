import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import mysql from 'mysql2/promise'
import { buildTemporaryMySqlPlan, withTemporaryMySql } from '../../scripts/test/support/temporary-mysql-harness.mjs'
import { hashPolicyBundleFactsForRevision, reuseEnvironmentPolicyPayload } from '../server/utils/environmentPolicyPayload.ts'
import { buildPolicyBundleV2CompatFields } from '../server/utils/policyBundleV2.ts'

// Extract production collectors with the TS AST: their SQL is executed unchanged.
const rootDir = resolve(import.meta.dirname, '../..')
const source = readFileSync(resolve(rootDir, 'platform/server/utils/policyBundle.ts'), 'utf8')
const names = ['collectTenantRoles', 'collectRoleHolderRevisions', 'collectTenantRolePermissions',
  'collectTenantRoleScopes', 'collectTenantRoleAppRoleMaps', 'collectSubjectRoles',
  'collectSubjectRoleScopes', 'collectTemplateRoles', 'collectTemplateOverrides']
const ast = ts.createSourceFile('policyBundle.ts', source, ts.ScriptTarget.Latest, true)
const declarations = ast.statements.filter(node => ts.isFunctionDeclaration(node)
  && [...names, 'excludeLegacyConsoleViewerRoleSql', 'syncInheritedSystemRoles'].includes(node.name?.text))
assert.equal(declarations.length, names.length + 2)
const sqlConstants = ast.statements.filter(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(d => ts.isIdentifier(d.name)
    && ['LEGACY_CONSOLE_VIEWER_ROLE_CODES', 'LEGACY_CONSOLE_VIEWER_ROLE_SQL'].includes(d.name.text)))
const selected = [...sqlConstants, ...declarations].map(node => node.getText(ast)).join('\n')
const compiled = ts.transpileModule(`${selected}\nexports.collectors = {${names.join(',')},syncInheritedSystemRoles}`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const plan = await buildTemporaryMySqlPlan({ rootDir,
  mysqld: process.env.MYSQLD || '/usr/local/mysql/bin/mysqld', mysql: process.env.MYSQL || '/usr/local/mysql/bin/mysql' })
await withTemporaryMySql(plan, async (context) => {
  const db = await mysql.createConnection({ ...context.connection('console'), multipleStatements: true })
  try {
    const tables = {
      tenant_roles: 'id,tenant_code,role_code,role_name,role_type,app_code,description,source,source_role_code,source_manifest_id,is_overridden,is_assignable,status,created_at,updated_at,max_active_assignments',
      tenant_role_holder_revisions: 'tenant_code,role_id,revision,updated_at',
      tenant_role_permissions: 'role_id,tenant_code,app_code,resource_code,action,source_manifest_action_id',
      tenant_role_scopes: 'role_id,tenant_code,app_code,resource_code,action,scope_type,scope_value,source_manifest_action_id,status',
      tenant_role_app_role_maps: 'role_id,tenant_code,app_role_code,source_system_role_code,sort_order',
      platform_app_roles: 'id,role_code,app_code,status',
      platform_system_roles: 'role_code,status',
      platform_app_role_permissions: 'app_role_id,app_code,resource_code,action,manifest_action_id',
      platform_app_role_scopes: 'app_role_id,app_code,resource_code,action,scope_type,scope_value,manifest_action_id,status',
      tenant_subjects: 'id,tenant_code,subject_type,subject_code,status',
      tenant_subject_roles: 'id,tenant_code,subject_id,role_id,source_type,source_id,assignment_kind,status,granted_at,starts_at,expired_at,source_id_key',
      tenant_subject_role_scopes: 'assignment_id,tenant_code,app_code,resource_code,action,scope_dimension,scope_predicate,scope_value,scope_group,scope_mode,status',
      tenant_permission_templates: 'id,tenant_code,template_code,status',
      tenant_template_roles: 'tenant_code,template_id,role_id,sort_order',
      tenant_template_overrides: 'tenant_code,subject_type,subject_id,role_id,override_type,source_template_id,reason,status'
    }
    for (const [name, columns] of Object.entries(tables)) {
      await db.query(`CREATE TABLE ${name} (${columns.split(',').map(c => `\`${c}\` VARCHAR(255) NULL`).join(',')}) ENGINE=InnoDB`)
    }
    const roleCodes = ['apf_sod_test_20261003', 'apf_sod_zhou_reconcile_20261004', 'normal_role']
    for (const [index, code] of roleCodes.entries()) {
      const id = index + 1
      await db.execute(`INSERT INTO tenant_roles(id,tenant_code,role_code,role_type,source,status,is_assignable,max_active_assignments) VALUES(?, 'T', ?, 'custom','custom','active','1','1')`, [id, code])
      await db.execute(`INSERT INTO tenant_role_permissions(role_id,tenant_code,app_code,resource_code,action) VALUES(?,'T','finance','receipts','view')`, [id])
      await db.execute(`INSERT INTO tenant_role_app_role_maps(role_id,tenant_code,app_role_code) VALUES(?,'T','finance.fixture')`, [id])
      await db.execute(`INSERT INTO tenant_subject_roles(id,tenant_code,subject_id,role_id,status,source_type) VALUES(?,'T','1',?,'active','manual')`, [id, id])
      await db.execute(`INSERT INTO tenant_subject_role_scopes(assignment_id,tenant_code,app_code,resource_code,action,scope_dimension,scope_predicate,status) VALUES(?,'T','finance','receipts','view','tenant','global','active')`, [id])
      await db.execute(`INSERT INTO tenant_template_roles(tenant_code,template_id,role_id) VALUES('T','1',?)`, [id])
      await db.execute(`INSERT INTO tenant_template_overrides(tenant_code,subject_id,role_id,override_type,status) VALUES('T','1',?,'add','active')`, [id])
    }
    await db.query(`UPDATE tenant_roles SET source='system',source_role_code='fixture-system',is_overridden='0' WHERE id='1';
      INSERT INTO platform_system_roles VALUES('fixture-system','active');
      INSERT INTO tenant_subjects VALUES('1','T','user','synthetic-user','active');
      INSERT INTO tenant_permission_templates VALUES('1','T','fixture','active');
      INSERT INTO platform_app_roles VALUES('1','finance.fixture','finance','active');
      INSERT INTO platform_app_role_permissions VALUES('1','finance','receipts','edit','1');
      INSERT INTO platform_app_role_scopes VALUES('1','finance','receipts','edit','tenant','global','1','active');`)
    for (let index = 0; index < 40; index++) {
      const id = index < 33 ? 1 : index < 39 ? 2 : 3
      await db.execute(`INSERT INTO tenant_role_scopes(role_id,tenant_code,app_code,resource_code,action,scope_type,scope_value,status) VALUES(?,'T','finance',?,'view','tenant','global','active')`, [id, `fixture_${index}`])
    }
    const exports = {}
    let materializations = 0
    runInNewContext(compiled, { exports,
      queryRows: async (sql, params) => (await db.execute(sql, params))[0],
      withTransaction: callback => callback({}),
      materializeSystemRole: async () => { materializations++ }
    })
    await exports.collectors.syncInheritedSystemRoles('T')
    assert.equal(materializations, 1)
    const collect = async () => Object.fromEntries(await Promise.all(names.map(async name => [name, await exports.collectors[name]('T')])))
    const before = await collect()
    assert.equal(before.collectTenantRoleScopes.filter(r => r.sourceType === 'custom' && r.roleCode !== 'normal_role').length, 39)
    const handlerSource = readFileSync(resolve(rootDir, 'platform/server/api/platform/tenant-admin/roles/[id].patch.ts'), 'utf8')
    const handlerExports = {}
    let allowed = true
    runInNewContext(ts.transpileModule(handlerSource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, {
      exports: handlerExports,
      require: name => name.endsWith('/db')
        ? {
            execute: async (sql, params) => (await db.execute(sql, params))[0],
            queryRow: async (sql, params) => (await db.execute(sql, params))[0][0] || null
          }
        : name.endsWith('/api')
          ? { ok: value => value, normalizeNullableString: value => value || null }
          : { requireTenantOwnerForTenantAdmin: () => { if (!allowed) throw Object.assign(new Error('denied'), { statusCode: 403 }) } },
      defineEventHandler: handler => handler,
      getRouterParam: event => event.id,
      readBody: async event => event.body,
      createError: value => Object.assign(new Error('request rejected'), value)
    })
    const request = id => ({ id: String(id), context: { platformTenantCode: 'T' }, body: { status: 'disabled', isAssignable: false } })
    allowed = false
    await assert.rejects(handlerExports.default(request(1)), { statusCode: 403 })
    allowed = true
    await assert.rejects(handlerExports.default({ ...request(1), context: { platformTenantCode: 'OTHER' } }), { statusCode: 404 })
    for (const id of [1, 2]) assert.equal((await handlerExports.default(request(id))).status, 'disabled')
    materializations = 0
    await exports.collectors.syncInheritedSystemRoles('T')
    assert.equal(materializations, 0, 'generation must not rematerialize a disabled inherited role')
    assert.equal((await db.query('SELECT is_overridden FROM tenant_roles WHERE id=\'1\''))[0][0].is_overridden, '1')
    const after = await collect()
    const oldFacts = hashPolicyBundleFactsForRevision(before)
    const newFacts = hashPolicyBundleFactsForRevision(after)
    assert.notEqual(oldFacts, newFacts)
    assert.equal(reuseEnvironmentPolicyPayload({ policy_revision: 39, policy_hash: oldFacts,
      status: 'active', expires_at: null, signature: 'fixture', signed_by_kid: 'fixture',
      bundle_hash: 'fixture', bundle_payload_json: before }, {
      revision: 39, hash: newFacts, expiresAt: null, sameTargets: true, now: Date.now()
    }), null, 'role retirement must invalidate reuse of the previously signed facts')
    for (const name of names) {
      assert.deepEqual(after[name], before[name].filter(r => r.roleCode === 'normal_role'), name)
    }
    for (const environment of ['prod', 'test']) {
      const compat = buildPolicyBundleV2CompatFields({ tenantCode: 'T', environment, baselinePermissions: [], conflictRules: [],
        subjectRoles: after.collectSubjectRoles, subjectRoleScopes: after.collectSubjectRoleScopes,
        rolePermissions: after.collectTenantRolePermissions, roleScopes: after.collectTenantRoleScopes })
      assert.doesNotMatch(JSON.stringify(compat), /apf_sod_test_20261003|apf_sod_zhou_reconcile_20261004/)
      assert.match(JSON.stringify(compat), /normal_role/)
    }
    assert.equal((await db.query('SELECT COUNT(*) n FROM tenant_role_scopes'))[0][0].n, 40)
    console.log('PASS: formal owner PATCH; 39 custom scopes excluded; custom/app-role/assignment/template paths closed; normal role and stored rows retained; prod/test V2 projection')
  } finally { await db.end() }
}, { execute: true, confirm: plan.confirmationSha256 })
