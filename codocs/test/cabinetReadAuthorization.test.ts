import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, test } from 'node:test'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function assertBefore(content: string, left: string, right: string) {
  const leftIndex = content.indexOf(left)
  const rightIndex = content.indexOf(right)
  assert.notEqual(leftIndex, -1, `Missing ${left}`)
  assert.notEqual(rightIndex, -1, `Missing ${right}`)
  assert.ok(leftIndex < rightIndex, `${left} must be before ${right}`)
}

describe('Codocs cabinet browser read authorization', () => {
  test('department mutations carry only a manager-verified, target-bound marker', () => {
    const helper = source('server/utils/cabinetRuntime.ts')
    const upload = source('server/api/dept-cabinet/upload.post.ts')
    const patch = source('server/api/dept-cabinet/[id].patch.ts')
    const remove = source('server/api/dept-cabinet/[id].delete.ts')

    assert.match(helper, /CODOCS_TRUSTED_CABINET_DEPARTMENT_MANAGER_QUERY_KEY/)
    assert.match(helper, /function trustedCabinetMutationQuery/)
    assert.match(helper, /departmentManagerCode\?: string/)
    assert.match(helper, /\[CODOCS_TRUSTED_CABINET_DEPARTMENT_MANAGER_QUERY_KEY\]: deptCode/)
    assert.match(helper, /Reflect\.deleteProperty\(result, key\)/)
    assertBefore(upload, 'requireDepartmentManagerAccess(event, actorUid, deptCode', 'createCabinetFileMetadata(event, \'department\'')
    assert.match(upload, /departmentManagerCode:\s*deptCode/)
    assertBefore(patch, 'requireDepartmentManagerAccess(event, actorUid, file.dept_code!', 'departmentManagerCode: file.dept_code!')
    assertBefore(remove, 'requireDepartmentManagerAccess(event, actorUid, file.dept_code!', 'departmentManagerCode: file.dept_code!')
  })

  test('the scoped metadata helper binds browser reads to a session actor and documents:view', () => {
    const helper = source('server/utils/cabinetRuntime.ts')

    assert.match(helper, /requireRequestUid\(event\)/)
    assert.match(helper, /requirePermission\(event, 'documents', 'view', '缺少文档查看权限'\)/)
    assert.match(helper, /requireDepartmentReadAccess\(event, actorUid, deptCode\)/)
    assert.match(helper, /CODOCS_TRUSTED_CABINET_DEPARTMENT_QUERY_KEY/)
    assert.match(helper, /Reflect\.deleteProperty\(result, key\)/)
    assert.match(helper, /'owner_uid', 'ownerUid', 'dept_code', 'deptCode'/)
    assertBefore(helper, 'const actorUid = requireRequestUid(event)', 'callCodocsTenantRuntime<CabinetFileMetadata>')
    assertBefore(helper, 'await requirePermission(event, \'documents\', \'view\'', 'callCodocsTenantRuntime<CabinetFileMetadata>')
    assertBefore(helper, 'await requireDepartmentReadAccess(event, actorUid, deptCode)', 'callCodocsTenantRuntime<CabinetFileMetadata>')
  })

  test('generic runtime forwarding cannot bypass browser cabinet list or detail scope construction', () => {
    const middleware = source('server/middleware/tenant-runtime.ts')

    assert.match(middleware, /apiPath === '\/api\/cabinet'/)
    assert.match(middleware, /apiPath === '\/api\/dept-cabinet'/)
    assert.match(middleware, /\^\\\/api\\\/\(\?:dept-\)\?cabinet\\\/\[\^\/\]\+\$/)
    assertBefore(middleware, 'if (method === \'GET\' && (', 'const mappings: Array')
  })

  test('every browser OSS read obtains scoped metadata before the side effect', () => {
    const personalRoutes = [
      ['server/api/cabinet/[id]/preview.get.ts', 'readCabinetTextPreview(event, file.oss_path)'],
      ['server/api/cabinet/[id]/preview.get.ts', 'getSignedUrl(file.oss_path'],
      ['server/api/cabinet/[id]/preview-html.get.ts', 'await client.get(file.oss_path)'],
      ['server/api/cabinet/[id]/preview-pptx.get.ts', 'await client.get(file.oss_path)'],
      ['server/api/cabinet/[id]/download.get.ts', 'getSignedUrl(file.oss_path']
    ]
    const departmentRoutes = [
      ['server/api/dept-cabinet/[id]/preview.get.ts', 'readCabinetTextPreview(event, file.oss_path)'],
      ['server/api/dept-cabinet/[id]/preview.get.ts', 'getSignedUrl(file.oss_path'],
      ['server/api/dept-cabinet/[id]/preview-html.get.ts', 'await client.get(file.oss_path)'],
      ['server/api/dept-cabinet/[id]/preview-pptx.get.ts', 'await client.get(file.oss_path)'],
      ['server/api/dept-cabinet/[id]/download.get.ts', 'getSignedUrl(file.oss_path']
    ]

    for (const [path, sideEffect] of [...personalRoutes, ...departmentRoutes]) {
      const content = source(path)
      assertBefore(content, 'getCabinetFileMetadata(event', sideEffect)
    }
    for (const [path] of departmentRoutes) {
      const content = source(path)
      assert.match(content, /departmentCode: deptCode/)
    }
  })

  test('export permission remains an additional gate rather than an object-read substitute', () => {
    const personalDownload = source('server/api/cabinet/[id]/download.get.ts')
    const departmentDownload = source('server/api/dept-cabinet/[id]/download.get.ts')
    const helper = source('server/utils/cabinetRuntime.ts')

    assert.match(personalDownload, /requirePermission\(event, 'documents', 'export'/)
    assert.match(departmentDownload, /requirePermission\(event, 'departments', 'export'/)
    assert.match(personalDownload, /getCabinetFileMetadata\(event, 'personal', id\)/)
    assert.match(departmentDownload, /getCabinetFileMetadata\(event, 'department', id, \{ departmentCode: deptCode \}\)/)
    assert.match(helper, /requirePermission\(event, 'documents', 'view', '缺少文档查看权限'\)/)
  })
})
