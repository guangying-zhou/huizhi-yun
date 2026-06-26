import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { resolveWebDevJobPermission } from '../server/utils/webdevJobPermissions.ts'

describe('resolveWebDevJobPermission', () => {
  test('普通 Codex 任务要求 execute', () => {
    assert.deepEqual(
      resolveWebDevJobPermission({ type: 'codex_task', templateId: 'codex.app-server', prompt: '修复部署页面文案' }),
      { resource: 'webdev_workspace', action: 'execute' }
    )
  })

  test('结构化部署任务要求 deploy', () => {
    assert.deepEqual(
      resolveWebDevJobPermission({ type: 'deploy_preview', module: 'finance' }),
      { resource: 'webdev_workspace', action: 'deploy' }
    )
    assert.deepEqual(
      resolveWebDevJobPermission({ templateId: 'release:deploy', target: 'prod' }),
      { resource: 'webdev_workspace', action: 'deploy' }
    )
    assert.deepEqual(
      resolveWebDevJobPermission({ command: 'pnpm run deploy:cloudflare' }),
      { resource: 'webdev_workspace', action: 'deploy' }
    )
  })

  test('非结构化文本不触发 deploy 提权', () => {
    assert.deepEqual(
      resolveWebDevJobPermission({ type: 'codex_task', prompt: '检查 deploy 页面为什么空白' }),
      { resource: 'webdev_workspace', action: 'execute' }
    )
  })
})
