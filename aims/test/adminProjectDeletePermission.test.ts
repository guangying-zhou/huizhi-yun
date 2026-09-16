import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

describe('admin project deletion permission', () => {
  test('delete control is visible only with Aims system administration permission', () => {
    const page = source('app/pages/admin/projects.vue')

    assert.match(page, /const \{ hasPermission \} = usePermissions\(\)/)
    assert.match(page, /const canDeleteProjects = computed\(\(\) => hasPermission\('admin', 'admin'\)\)/)
    assert.match(page, /<UButton\s+v-if="canDeleteProjects"[\s\S]*?title="彻底删除"/)
    assert.match(page, /const canConfirmDelete = computed\(\(\) => \{\s+if \(!canDeleteProjects\.value\) return false/)
  })

  test('DELETE admin project route rejects project-only administrators', () => {
    const access = source('server/utils/aimsAdminAccess.ts')
    const middleware = source('server/middleware/tenant-runtime.ts')

    assert.match(access, /export async function requireAimsProjectDeleteAccess/)
    assert.match(access, /requirePermission\(event, 'admin', 'admin', message\)/)
    assert.match(middleware, /function isAdminProjectDeleteRequest/)
    assert.match(middleware, /await requireAimsProjectDeleteAccess\(event\)/)
    assert.match(middleware, /const aimsProjectDeleteAccessVerifiedKey = Symbol/)
    assert.match(
      middleware,
      /await requireAimsProjectDeleteAccess\(event\)\s+markAimsProjectDeleteAccessVerified\(event\)/
    )
    assert.match(
      middleware,
      /if \(isAdminProjectDeleteRequest\(context\.method, context\.suffix\)\) \{\s+return isAimsProjectDeleteAccessVerified\(context\.event\)\s+\}/
    )
    assert.doesNotMatch(
      middleware,
      /if \(isAdminProjectDeleteRequest\(context\.method, context\.suffix\)\) \{\s+return await hasAimsAdminRoleAccess/
    )

    const deleteGuard = middleware.indexOf('await requireAimsProjectDeleteAccess(event)')
    const projectManageGuard = middleware.indexOf('await requireAimsProjectManageAccess(event)')
    assert.ok(deleteGuard >= 0 && deleteGuard < projectManageGuard)
  })
})
