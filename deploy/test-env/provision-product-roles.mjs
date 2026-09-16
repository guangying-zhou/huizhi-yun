import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
if (process.argv[2] !== '--execute' || execFileSync('hostname', { encoding: 'utf8' }).trim() !== 'iZcqwiqyhp9u8rZ') throw Error('Test host required')
const e = JSON.parse(execFileSync('pm2', ['jlist'], { stdio: 'pipe' })).find(p => p.name === 'hzy-platform-dev').pm2_env
if (e.DB_NAME !== 'hzy_platform_dev' || e.PLATFORM_SERVICE_URL !== 'https://hzy.wiztek.cn') throw Error('Test control plane required')
const require = createRequire(e.pm_cwd + '/.output/server/index.mjs')
const db = await require('mysql2/promise').createConnection({ host: e.DB_HOST, port: Number(e.DB_PORT || 3306), user: e.DB_USER, password: e.DB_PASSWORD, database: e.DB_NAME })
try {
  await db.beginTransaction()
  const [subjects] = await db.query("SELECT id FROM tenant_subjects WHERE tenant_code='C000001' AND subject_code='zhouguangying' AND status='active'")
  if (subjects.length !== 1) throw Error('Subject mismatch')
  const summary = []
  for (const [code, name, scopeType, scopeValue] of [['product_manager', '产品经理', 'product', 'manager'], ['product_director', '产品总监', 'tenant', 'global']]) {
    const [appRoles] = await db.query("SELECT id FROM platform_app_roles WHERE role_code=? AND status='active'", ['aims:' + code])
    if (appRoles.length !== 1) throw Error('Manifest role missing')
    const [permissions] = await db.query('SELECT app_code,resource_code,action FROM platform_app_role_permissions WHERE app_role_id=?', [appRoles[0].id])
    if (!permissions.length || (code === 'product_director' && !permissions.some(p => p.resource_code === 'products' && p.action === 'onboard'))) throw Error('Manifest incomplete')
    const [existing] = await db.query("SELECT id FROM tenant_roles WHERE tenant_code='C000001' AND role_code=?", [code])
    if (!existing.length && code === 'product_manager') {
      await db.query("UPDATE tenant_roles SET role_code='product_manager',role_name='产品经理' WHERE tenant_code='C000001' AND role_code='test_product_manager'")
    }
    await db.query("INSERT INTO tenant_roles (tenant_code,role_code,role_name,role_type,source,is_assignable,status) SELECT 'C000001',?,?,'custom','custom',1,'active' WHERE NOT EXISTS (SELECT 1 FROM tenant_roles WHERE tenant_code='C000001' AND role_code=?)", [code, name, code])
    const [roles] = await db.query("SELECT id FROM tenant_roles WHERE tenant_code='C000001' AND role_code=? FOR UPDATE", [code])
    const id = roles[0].id
    await db.query("UPDATE tenant_roles SET role_name=?,is_assignable=1,status='active',policy_revision=policy_revision+1,source_policy_hash=NULL,effective_policy_hash=NULL,policy_updated_at=UTC_TIMESTAMP() WHERE id=?", [name, id])
    await db.query("INSERT INTO tenant_role_app_role_maps (tenant_code,role_id,app_role_code) SELECT 'C000001',?,? WHERE NOT EXISTS (SELECT 1 FROM tenant_role_app_role_maps WHERE role_id=? AND app_role_code=?)", [id, 'aims:' + code, id, 'aims:' + code])
    for (const p of permissions) {
      await db.query("INSERT INTO tenant_role_scopes (tenant_code,role_id,app_code,resource_code,action,scope_type,scope_value,status) VALUES ('C000001',?,?,?,?,?,?,'active') ON DUPLICATE KEY UPDATE status='active'", [id, p.app_code, p.resource_code, p.action, scopeType, scopeValue])
    }
    if (code === 'product_director') {
      await db.query("INSERT INTO tenant_subject_roles (tenant_code,subject_id,role_id,reason) SELECT 'C000001',?,?,'User-authorized product director setup for C000001 test account' WHERE NOT EXISTS (SELECT 1 FROM tenant_subject_roles WHERE tenant_code='C000001' AND subject_id=? AND role_id=? AND status='active')", [subjects[0].id, id, subjects[0].id, id])
    }
    summary.push({ roleId: id, code, name, permissions: permissions.length, scope: scopeType + ':' + scopeValue })
  }
  await db.commit()
  console.log(JSON.stringify(summary))
} catch (error) { await db.rollback(); console.error(error.message); process.exitCode = 1 } finally { await db.end() }
