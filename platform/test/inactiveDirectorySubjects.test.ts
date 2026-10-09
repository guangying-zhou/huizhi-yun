import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('person list defaults active and show inactive is explicit and server-paginated', () => {
  const api = read('server/api/platform/_handlers/users.get.ts')
  assert.match(api, /query.showInactive === 'true' \? null : 'active'/)
  assert.match(api, /ts.status = \?/)
  assert.match(api, /LIMIT \? OFFSET \?/)
  const ui = read('app/components/console/UsersManager.vue')
  assert.match(ui, /status: 'active'/)
  assert.match(ui, /显示已停用/)
})
test('assignments expose account status and inactive accounts never count as effective', () => {
  const api = read('server/api/platform/tenant-admin/subject-roles.get.ts')
  assert.match(api, /WHEN ts.status = 'active' AND tsr.status = 'active'/)
  assert.match(api, /subjectStatus: row.subject_status/)
  const command = read('server/api/platform/tenant-admin/subject-roles.post.ts')
  assert.match(command, /subject.status !== 'active'/)
  assert.match(command, /SELECT id, status FROM tenant_subjects WHERE tenant_code = \? AND id = \? FOR UPDATE/)
  assert.match(command, /currentSubject.status !== 'active'/)
  const ui = read('app/components/console/AuthorizationRoleAssignmentsModal.vue')
  assert.match(ui, /账号已停用、授权不生效/)
  assert.match(read('app/components/console/AuthorizationsManager.vue'), /item\?\.subjectType === 'user' && item.status === 'active'/)
})

test('actual assignment handler rejects inactive subjects and a concurrent deactivation before insertion', async () => {
  const { build } = await import('esbuild')
  const { createRequire } = await import('node:module')
  const { createError } = await import('h3')
  const file = new URL('../server/api/platform/tenant-admin/subject-roles.post.ts', import.meta.url).pathname
  const result = await build({ entryPoints: [file], bundle: true, platform: 'node', format: 'cjs', write: false, plugins: [{ name: 'test-owning-dependencies', setup(builder) {
    builder.onResolve({ filter: /^~~\/server\/utils\// }, args => ({ path: args.path, namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.endsWith('/db')
      ? 'export const queryRow = (...args) => globalThis.__inactiveFixture.queryRow(...args); export const withTransaction = callback => callback(globalThis.__inactiveFixture.tx)'
      : args.path.endsWith('/api')
        ? 'export const requireString = value => String(value || ""); export const normalizeNullableString = value => value == null ? null : String(value); export const ok = value => value'
        : args.path.endsWith('/staticRoleConflicts')
          ? 'export const evaluateSubjectRoleAssignmentConflicts = async () => ({ blockingConflicts: [], warnings: [] })'
          : args.path.endsWith('/tenantAdminAccess')
            ? 'export const requireTenantOwnerForTenantAdmin = () => {}'
            : args.path.endsWith('/tenantSystemRoles')
              ? 'export const materializeSystemRole = () => { throw new Error("unexpected materialization") }'
              : 'export const assertRoleAssignmentConstraints = async () => {}; export const bumpRoleHolderRevision = async () => 1' }))
  } }] })
  const fixtureModule = { exports: {} as { default: (event: unknown) => unknown } }
  const globals = globalThis as unknown as Record<string, unknown>
  const previous = new Map(['defineEventHandler', 'readBody', 'createError', '__inactiveFixture'].map(key => [key, globals[key]]))
  globals.defineEventHandler = (handler: unknown) => handler
  globals.readBody = async () => ({ tenantCode: 'FIXTURE', subjectType: 'user', subjectId: 1, roleId: 2 })
  globals.createError = createError
  try {
    new Function('require', 'module', 'exports', result.outputFiles[0]!.text)(createRequire(import.meta.url), fixtureModule, fixtureModule.exports)
    for (const initialStatus of ['disabled', 'active']) {
      let inserts = 0
      globals.__inactiveFixture = {
        queryRow: async (sql: string) => sql.includes('FROM tenant_subjects') ? { id: 1, status: initialStatus, subject_type: 'user' } : { id: 2, status: 'active', is_assignable: 1 },
        tx: {
          queryRow: async (sql: string) => sql.includes('FROM tenant_subjects') ? { id: 1, status: 'disabled' } : null,
          execute: async () => {
            inserts++
            return { affectedRows: 1 }
          }
        }
      }
      await assert.rejects(async () => fixtureModule.exports.default({ context: {} }), (error: unknown) => {
        const refusal = error as { statusCode: number, data: { code: string } }
        return refusal.statusCode === 409 && refusal.data.code === 'subject_inactive'
      })
      assert.equal(inserts, 0)
    }
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) Reflect.deleteProperty(globals, key)
      else globals[key] = value
    }
  }
})

test('Directory projection identity cannot be manually re-enabled or detached through personnel edit', async () => {
  const { createHash } = await import('node:crypto')
  const { isDirectoryProjectedUser } = await import('../server/utils/directorySubjectStatus.ts')
  const uid = 'fixture-user'
  assert.equal(isDirectoryProjectedUser(uid, createHash('sha256').update(`console:user:${uid}`).digest('hex')), true)
  assert.equal(isDirectoryProjectedUser(uid, 'manual-external-ref'), false)
  assert.equal(isDirectoryProjectedUser(uid, null), false)
  const patch = read('server/api/platform/_handlers/users/[id].patch.ts')
  assert.match(patch, /body.status !== undefined && !directoryManaged/)
  assert.match(patch, /body.username !== undefined && !directoryManaged/)
  assert.match(patch, /code: 'directory_subject_managed'/)
  const subjectPatch = read('server/api/platform/_handlers/subjects/[id].patch.ts')
  assert.match(subjectPatch, /body.status !== undefined && !directoryManaged/)
  assert.match(subjectPatch, /body.externalRef !== undefined && !directoryManaged/)
})

test('member-permission picker exposes inactive rows only when requested and never selects them', () => {
  assert.match(read('server/api/platform/tenant-admin/member-permissions.get.ts'), /if \(query.showInactive !== 'true'\) where.push/)
  const ui = read('app/components/console/MemberPermissionsManager.vue')
  assert.match(ui, /显示已停用/)
  assert.match(ui, /:disabled="member.status !== 'active'"/)
  assert.match(ui, /账号已停用、授权不生效/)
})
