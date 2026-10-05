import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

function assertBefore(content: string, left: string, right: string) {
  const leftIndex = content.indexOf(left)
  const rightIndex = content.indexOf(right)

  assert.notEqual(leftIndex, -1, `Missing ${left}`)
  assert.notEqual(rightIndex, -1, `Missing ${right}`)
  assert.ok(leftIndex < rightIndex, `${left} must appear before ${right}`)
}

describe('Console runtime app permissions', () => {
  test('runtime app list and PM2 actions use runtime app permissions', () => {
    const list = source('server/api/v1/console/runtime/apps/index.get.ts')
    const action = source('server/api/v1/console/runtime/apps/[appCode]/action.post.ts')

    assert.match(list, /requirePermission\(event, 'runtime_apps', 'view'\)/)
    assertBefore(
      action,
      'requirePermission(event, \'runtime_apps\', \'admin\')',
      'readBody(event)'
    )
    assertBefore(
      action,
      'requirePermission(event, \'runtime_apps\', \'admin\')',
      'const result = await applyRuntimeAppAction'
    )
    assert.doesNotMatch(action, /system_settings/)
  })

  test('runtime app page gates PM2 controls separately from status visibility', () => {
    const content = source('app/pages/admin/runtime-apps.vue')

    assert.match(content, /const canAdminRuntimeApps = computed\(\(\) => permissionsLoaded\.value && hasPermission\('runtime_apps', 'admin'\)\)/)
    assert.match(content, /if \(!canAdminRuntimeApps\.value\) \{[\s\S]*需要应用运行管理权限/)
    assert.match(content, /:disabled="!canAdminRuntimeApps \|\| !app\.manageable \|\| app\.status === 'online'"/)
    assert.match(content, /:disabled="!canAdminRuntimeApps \|\| !app\.manageable \|\| app\.status !== 'online'"/)
  })

  test('manifest declares runtime apps as a distinct control resource', () => {
    const manifest = JSON.parse(source('app.manifest.json')) as {
      resources: Array<{ code: string, actions: string[] }>
      recommendedRoles: Array<{ code: string, suggestedPermissions: string[] }>
    }
    const resource = manifest.resources.find(item => item.code === 'runtime_apps')
    assert.deepEqual(resource?.actions, ['view', 'admin'])

    const operator = manifest.recommendedRoles.find(item => item.code === 'console:operator')
    const securityAdmin = manifest.recommendedRoles.find(item => item.code === 'console:security_admin')
    const admin = manifest.recommendedRoles.find(item => item.code === 'console:admin')

    assert.equal(operator?.suggestedPermissions.includes('console:runtime_apps:view'), true)
    assert.equal(operator?.suggestedPermissions.includes('console:runtime_apps:admin'), false)
    assert.equal(securityAdmin?.suggestedPermissions.includes('console:runtime_apps:admin'), true)
    assert.equal(admin?.suggestedPermissions.includes('console:runtime_apps:admin'), true)
  })
})
