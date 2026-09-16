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

describe('Console directory sync permissions', () => {
  test('subject export rebuild requires admin before starting the sync job', () => {
    const content = source('server/api/v1/console/directory/sync-jobs/index.post.ts')
    const handlerBlock = content.slice(content.indexOf('export default defineEventHandler'))

    assertBefore(
      handlerBlock,
      'requirePermission(event, \'directory_sync\', \'edit\'',
      'readBody<{'
    )
    assert.match(handlerBlock, /objectScope === 'subjects'/)
    assert.match(handlerBlock, /objectScope === 'all'/)
    assertBefore(
      handlerBlock,
      'requirePermission(event, \'directory_sync\', \'admin\', \'需要目录同步管理员权限\')',
      'startConsoleDirectorySubjectSync(event'
    )
  })

  test('directory sync page separates provider sync from Platform subject sync permissions', () => {
    const content = source('app/pages/directory/sync.vue')

    assert.match(content, /const canRunSync = computed\(\(\) => permissionsLoaded\.value && hasPermission\('directory_sync', 'edit'\)\)/)
    assert.match(content, /const canRebuildSubjectExports = computed\(\(\) => permissionsLoaded\.value && hasPermission\('directory_sync', 'admin'\)\)/)
    assert.match(content, /if \(!canRebuildSubjectExports\.value\) \{[\s\S]*需要目录同步管理员权限/)
    assert.match(content, /if \(!canRunSync\.value\) \{[\s\S]*需要目录同步编辑权限/)
    assert.match(content, /:disabled="!canRebuildSubjectExports"[\s\S]*@click="rebuildSubjectExports"/)
    assert.match(content, /同步到 Platform/)
    assert.match(content, /@click="runProviderSync\('ldap'\)"/)
    assert.doesNotMatch(content, /runProviderSync\('(account|dingtalk|wecom|gitlab)'\)/)
    assert.match(content, /钉钉组织和人员事实同步已迁移到 People/)
    assert.match(content, /to="\/shell\/people\?target=%2Fpeople%2Fsettings%2Fhr-source-sync"/)

    const handler = source('server/api/v1/console/directory/sync-jobs/index.post.ts')
    assert.match(handler, /providerCode === 'dingtalk'[\s\S]*statusCode: 410/)
  })
})
