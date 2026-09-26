// G1 LE-A09/A10 role matrix for the C000001/test `test` user on the development
// Platform (user-authorized test-data change, 2026-09-23). One real SSO login,
// switched between exact role profiles between browser checks. Mirrors the
// tenant-admin/subject-roles.post.ts writes (assignment row + role holder
// revision) and regenerates the tenant bundle through the existing legacy
// bundle path so the signed envelope carries a new policy revision.
// Pre-existing assignments are only ever toggled active<->suspended and are
// snapshotted before the first change; `restore` returns exactly that state.
// Run on gitlab.wiztek.cn: node roles.mjs status | profile <readonly|employee|pm|none> | restore
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const name = 'hzy-platform-dev'
const tenant = 'C000001'
const subjectCode = 'test'
const REASON = 'G1 LE-A09 acceptance (temporary)'
const PROFILES = { readonly: ['console.viewer'], employee: ['aims.member'], pm: ['aims.member', 'project_manager'], none: [] }
const BASELINE = new URL('./roles-baseline.json', import.meta.url)
const [mode, profile] = process.argv.slice(2)
if (!['status', 'profile', 'restore'].includes(mode)) throw Error('mode must be status, profile or restore')
if (mode === 'profile' && !Object.hasOwn(PROFILES, profile)) throw Error(`profile must be one of ${Object.keys(PROFILES).join(', ')}`)
if (execFileSync('hostname', { encoding: 'utf8' }).trim() !== 'iZcqwiqyhp9u8rZ') throw Error('host mismatch')
const live = JSON.parse(execFileSync('pm2', ['jlist'], { encoding: 'utf8' })).find(p => p.name === name)
if (!live?.pid) throw Error('Platform process missing')
const env = Object.fromEntries(fs.readFileSync(`/proc/${live.pid}/environ`, 'utf8').split('\0').filter(Boolean)
  .map(item => [item.slice(0, item.indexOf('=')), item.slice(item.indexOf('=') + 1)]))
if (env.DB_NAME !== 'hzy_platform_dev' || env.PORT !== '3011') throw Error('runtime binding mismatch')
const token = env.HZY_CLOUDFLARE_INTERNAL_TOKEN || env.PLATFORM_INTERNAL_SERVICE_TOKENS?.split(',')[0]?.trim() || env.PLATFORM_INTERNAL_SERVICE_TOKEN
const require = createRequire(`${live.pm2_env.pm_cwd}/package.json`)
const c = await require('mysql2/promise').createConnection({ host: env.DB_HOST, port: Number(env.DB_PORT || 3306),
  user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME })
const q = async (sql, params = []) => (await c.query(sql, params))[0]
const subject = (await q("SELECT id FROM tenant_subjects WHERE tenant_code=? AND subject_type='user' AND subject_code=? AND status='active'", [tenant, subjectCode]))[0]
if (!subject) throw Error('subject missing')
const assignments = () => q(`SELECT a.id, r.id AS role_id, r.role_code, a.status, a.reason = ? AS ours FROM tenant_subject_roles a JOIN tenant_roles r ON r.id=a.role_id
  WHERE a.tenant_code=? AND a.subject_id=? ORDER BY a.id`, [REASON, tenant, subject.id])
const revision = async () => (await q('SELECT policy_revision FROM tenant_policy_revisions WHERE tenant_code=?', [tenant]))[0]?.policy_revision
// Publishing: the legacy bundle GET does NOT regenerate while any older active
// bundle exists (bundles are never superseded), and expiring the current one
// makes an older revision current. A new revision must come from the Platform
// publish path (tenant-admin or ops bundles.post, generatePolicyBundle).
const regenerate = async () => {
  if (process.env.G1_PUBLISH !== 'ops') return // publishing needs the Platform publish path; see tracker
  const response = await fetch(`http://127.0.0.1:3011/api/platform/internal/console/tenants/${tenant}/bundle?environment=test&deploymentCode=wiztek-test-console`,
    { headers: { authorization: `Bearer ${token}`, 'x-hzy-internal-principal': 'g1-role-matrix' }, signal: AbortSignal.timeout(120000) })
  await response.body?.cancel()
  if (response.status !== 200) throw Error(`bundle regeneration failed: ${response.status}`)
}
const bump = roleId => q(`INSERT INTO tenant_role_holder_revisions (tenant_code, role_id, revision, updated_at) VALUES (?, ?, 1, UTC_TIMESTAMP())
  ON DUPLICATE KEY UPDATE revision = revision + 1, updated_at = UTC_TIMESTAMP()`, [tenant, roleId])
// Target state: `wanted` role codes active, everything else not active.
const apply = async (wanted, baseline) => {
  await c.beginTransaction()
  try {
    const rows = await q(`SELECT a.id, r.id AS role_id, r.role_code, a.status, a.reason = ? AS ours FROM tenant_subject_roles a JOIN tenant_roles r ON r.id=a.role_id
      WHERE a.tenant_code=? AND a.subject_id=? FOR UPDATE`, [REASON, tenant, subject.id])
    for (const row of rows) {
      const want = wanted.includes(row.role_code)
      const target = row.ours ? (want ? 'active' : 'revoked') : (want ? 'active' : 'suspended')
      if (!row.ours && !baseline.some(b => b.id === row.id)) throw Error('unknown pre-existing assignment; refusing')
      if (row.status !== target) {
        await q('UPDATE tenant_subject_roles SET status=? WHERE id=?', [target, row.id])
        await bump(row.role_id)
      }
    }
    for (const code of wanted) {
      if (rows.some(row => row.role_code === code)) continue
      const role = (await q("SELECT id FROM tenant_roles WHERE tenant_code=? AND role_code=? AND status='active' AND is_assignable=1", [tenant, code]))[0]
      if (!role) throw Error(`role missing: ${code}`)
      await q(`INSERT INTO tenant_subject_roles (tenant_code, subject_id, role_id, source_type, assignment_kind, source_id, reason, granted_by_uid, granted_at, starts_at, expired_at, status)
        VALUES (?, ?, ?, 'manual', 'position', NULL, ?, 'g1-acceptance', UTC_TIMESTAMP(), NULL, NULL, 'active')`, [tenant, subject.id, role.id, REASON])
      await bump(role.id)
    }
    await c.commit()
  } catch (error) {
    await c.rollback()
    throw error
  }
}
try {
  const before = await revision()
  if (mode !== 'status') {
    if (!fs.existsSync(BASELINE)) {
      const current = await assignments()
      if (current.some(row => row.ours)) throw Error('tagged rows exist without a baseline snapshot')
      fs.writeFileSync(BASELINE, JSON.stringify(current.map(({ id, role_code, status }) => ({ id, role_code, status }))), { flag: 'wx', mode: 0o600 })
    }
    const baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf8'))
    if (mode === 'profile') await apply(PROFILES[profile], baseline)
    if (mode === 'restore') {
      await c.beginTransaction()
      try {
        for (const row of await assignments()) {
          const original = baseline.find(b => b.id === row.id)
          const target = original ? original.status : 'revoked'
          if (row.status !== target) {
            await q('UPDATE tenant_subject_roles SET status=? WHERE id=?', [target, row.id])
            await bump(row.role_id)
          }
        }
        await c.commit()
      } catch (error) {
        await c.rollback()
        throw error
      }
    }
    await regenerate()
  }
  const now = await assignments()
  console.log(JSON.stringify({ subject: subjectCode, active: now.filter(r => r.status === 'active').map(r => r.role_code),
    inactive: now.filter(r => r.status !== 'active').map(r => `${r.role_code}:${r.status}`), policyRevision: { before, after: await revision() } }))
} finally {
  await c.end()
}
