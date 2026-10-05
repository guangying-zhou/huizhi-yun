import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

const root = fileURLToPath(new URL('..', import.meta.url))

function source(path: string) {
  return readFileSync(new URL(path, `file://${root}/`), 'utf8')
}

const directoryRoutes = [
  ['server/api/account/users/index.get.ts', 'directory_users'],
  ['server/api/account/users/[uid].get.ts', 'directory_users'],
  ['server/api/account/users/[uid]/projects.get.ts', 'directory_users'],
  ['server/api/account/users/batch.post.ts', 'directory_users'],
  ['server/api/account/user-departments.get.ts', 'directory_users'],
  ['server/api/account/departments.get.ts', 'directory_departments'],
  ['server/api/account/department-info.get.ts', 'directory_departments'],
  ['server/api/account/department-members.get.ts', 'directory_departments'],
  ['server/api/account/projects/index.get.ts', 'directory_projects'],
  ['server/api/account/projects/[projectCode].get.ts', 'directory_projects']
] as const

describe('Account-named Console compatibility routes', () => {
  test('apply the same Directory read permission boundary as the formal Directory API', () => {
    for (const [path, resource] of directoryRoutes) {
      const content = source(path)
      const handler = content.slice(content.indexOf('export default defineEventHandler'))

      assert.match(content, /import \{ requirePermission \} from '~~\/server\/utils\/checkPermission'/)
      assert.match(handler, new RegExp(`requirePermission\\(event, '${resource}', 'view'\\)`))
    }
  })

  test('requires a verified local session before config, self-service department, or clipboard access', () => {
    for (const path of [
      'server/api/account/config-check.get.ts',
      'server/api/account/accessible-departments.get.ts',
      'server/api/account/clipboard.get.ts',
      'server/api/account/clipboard.post.ts'
    ]) {
      const content = source(path)
      const handler = content.slice(content.indexOf('export default defineEventHandler'))

      assert.match(content, /import \{ requireConsoleRequestUid \} from '~~\/server\/utils\/requestIdentity'/)
      assert.match(handler, /await requireConsoleRequestUid\(event\)/)
    }
  })

  test('binds accessible departments and clipboard reads/writes to the current session uid', () => {
    const accessible = source('server/api/account/accessible-departments.get.ts')
    const clipboardGet = source('server/api/account/clipboard.get.ts')
    const clipboardPost = source('server/api/account/clipboard.post.ts')

    assert.match(accessible, /if \(uid !== requestUid\) throw createError\(\{ statusCode: 403/)
    assert.match(clipboardGet, /if \(uid && uid !== requestUid\) throw createError\(\{ statusCode: 403/)
    assert.match(clipboardGet, /getClipboard\(event\)/)
    assert.match(clipboardPost, /if \(body\.uid && body\.uid !== requestUid\)/)
    assert.match(clipboardPost, /setClipboard\(event, body\)/)
    assert.doesNotMatch(`${clipboardGet}\n${clipboardPost}`, /server\/utils\/db|queryRow|execute|withTransaction/)
  })
})
