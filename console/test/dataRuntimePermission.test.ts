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

describe('Console data runtime permissions', () => {
  test('remote update requires explicit data runtime deploy permission', () => {
    const content = source('server/api/v1/console/data-runtime/update.post.ts')
    const handlerBlock = content.slice(content.indexOf('export default defineEventHandler'))

    assertBefore(
      handlerBlock,
      'requirePermission(event, \'data_runtime\', \'deploy\')',
      'triggerDataRuntimeUpdate(event)'
    )
    assert.doesNotMatch(handlerBlock, /system_settings.*edit/)
  })

  test('runtime status reads require data runtime view permission', () => {
    const status = source('server/api/v1/console/data-runtime/status.get.ts')
    const updateStatus = source('server/api/v1/console/data-runtime/update-status.get.ts')

    assert.match(status, /requirePermission\(event, 'data_runtime', 'view'\)/)
    assert.match(updateStatus, /requirePermission\(event, 'data_runtime', 'view'\)/)
  })

  test('data runtime settings are not guarded only by generic system settings edit', () => {
    const content = source('server/api/v1/console/settings/values/[settingKey].put.ts')
    const helperBlock = content.slice(
      content.indexOf('async function requireSettingEditAccess'),
      content.indexOf('export default defineEventHandler')
    )

    assert.match(helperBlock, /settingKey\.startsWith\('dataRuntime\.'\)/)
    assert.match(helperBlock, /requirePermission\(event, 'data_runtime', 'edit'\)/)
    assertBefore(
      content,
      'requireSettingEditAccess(event, settingKey)',
      'readBody<{'
    )
  })

  test('data runtime page separates view, edit and deploy capabilities', () => {
    const content = source('app/pages/data-runtime.vue')

    assert.match(content, /const canViewDataRuntime = computed\(\(\) => permissionsLoaded\.value && hasPermission\('data_runtime', 'view'\)\)/)
    assert.match(content, /const canEditDataRuntime = computed\(\(\) => permissionsLoaded\.value && hasPermission\('data_runtime', 'edit'\)\)/)
    assert.match(content, /const canDeployDataRuntime = computed\(\(\) => permissionsLoaded\.value && hasPermission\('data_runtime', 'deploy'\)\)/)
    assert.match(content, /immediate:\s*canViewDataRuntime\.value/)
    assert.match(content, /if \(!canViewDataRuntime\.value\) \{[\s\S]*需要数据运行时查看权限/)
    assert.match(content, /if \(!canEditDataRuntime\.value\) \{[\s\S]*需要数据运行时编辑权限/)
    assert.match(content, /if \(!canDeployDataRuntime\.value\) \{[\s\S]*需要数据运行时部署权限/)
    assert.match(content, /:disabled="!canViewDataRuntime"[\s\S]*@click="refreshOverview"/)
    assert.match(content, /:disabled="!canEditDataRuntime"[\s\S]*@click="saveParameters"/)
    assert.match(content, /:disabled="!canDeployDataRuntime"[\s\S]*@click="triggerUpdate"/)
  })

  test('data runtime menu and route guard use data runtime view permission', () => {
    const content = source('app/config/permissions.ts')

    assert.match(content, /label:\s*'数据运行时'[\s\S]*to:\s*'\/data-runtime'[\s\S]*resource:\s*'data_runtime'/)
    assert.match(content, /pattern:\s*'\/data-runtime',\s*resource:\s*'data_runtime',\s*action:\s*'view'/)
    assert.match(content, /pattern:\s*'\/data-runtime\/\*\*',\s*resource:\s*'data_runtime',\s*action:\s*'view'/)
    assert.doesNotMatch(content, /to:\s*'\/data-runtime'[\s\S]{0,120}resource:\s*'system_settings'/)
  })

  test('console manifest exposes deploy as a distinct data runtime action', () => {
    const manifest = JSON.parse(source('app.manifest.json')) as {
      resources: Array<{ code: string, actions: string[] }>
      recommendedRoles: Array<{ code: string, suggestedPermissions: string[] }>
    }
    const resource = manifest.resources.find(item => item.code === 'data_runtime')
    assert.deepEqual(resource?.actions, ['view', 'edit', 'deploy', 'admin'])

    const operator = manifest.recommendedRoles.find(item => item.code === 'console:operator')
    const securityAdmin = manifest.recommendedRoles.find(item => item.code === 'console:security_admin')
    const admin = manifest.recommendedRoles.find(item => item.code === 'console:admin')

    assert.equal(operator?.suggestedPermissions.includes('console:data_runtime:deploy'), false)
    assert.equal(securityAdmin?.suggestedPermissions.includes('console:data_runtime:deploy'), true)
    assert.equal(admin?.suggestedPermissions.includes('console:data_runtime:deploy'), true)
  })
})
