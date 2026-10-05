import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('tenant-admin member permissions API', () => {
  test('member list active role count is batched instead of building full grants per row', () => {
    const content = source('server/api/platform/tenant-admin/member-permissions.get.ts')

    assert.match(content, /async function loadActiveRoleCounts\(tenantCode: string, members: MemberRow\[\]\)/)
    assert.match(content, /const activeRoleCounts = await loadActiveRoleCounts\(tenantCode, rows\)/)
    assert.match(content, /const items = rows\.map\(\(row\) => \{/)
    assert.match(content, /const uid = row\.external_ref \|\| row\.subject_code/)
    assert.match(content, /activeRoleCount: activeRoleCounts\.get\(row\.id\) \|\| 0/)
    assert.doesNotMatch(content, /Promise\.all\(rows\.map\(async/)
    assert.doesNotMatch(content, /buildDbAuthorizationGrants\(tenantCode, uid, null\)/)
    assert.doesNotMatch(content, /COUNT\(DISTINCT CASE[\s\S]*AS active_role_count/)
  })

  test('batched member role counts include inherited roles and template overrides', () => {
    const content = source('server/api/platform/tenant-admin/member-permissions.get.ts')

    assert.match(content, /tenant_subject_memberships/)
    assert.match(content, /container\.subject_type IN \('department', 'job'\)/)
    assert.match(content, /tenant_subject_roles tsr/)
    assert.match(content, /tenant_template_bindings ttb/)
    assert.match(content, /tenant_template_overrides tto/)
    assert.match(content, /row\.override_type === 'exclude'/)
    assert.match(content, /removeDirectTemplateRoleSourcesForUser/)
  })
})
