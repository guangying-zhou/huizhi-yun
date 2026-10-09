import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'

const root = fileURLToPath(new URL('..', import.meta.url))

function source(path: string) {
  return readFileSync(new URL(path, `file://${root}/`), 'utf8')
}

const routes = [
  ['server/api/v1/directory/users/index.get.ts', 'directory_users'],
  ['server/api/v1/directory/users/[uid].get.ts', 'directory_users'],
  ['server/api/v1/directory/users/[uid]/projects.get.ts', 'directory_users'],
  ['server/api/v1/directory/users/batch.post.ts', 'directory_users'],
  ['server/api/v1/directory/user-departments.get.ts', 'directory_users'],
  ['server/api/v1/directory/departments/index.get.ts', 'directory_departments'],
  ['server/api/v1/directory/departments/[deptCode].get.ts', 'directory_departments'],
  ['server/api/v1/directory/departments/[deptCode]/members.get.ts', 'directory_departments'],
  ['server/api/v1/directory/dept-members.get.ts', 'directory_departments'],
  ['server/api/v1/directory/projects/index.get.ts', 'directory_projects'],
  ['server/api/v1/directory/projects/[projectCode].get.ts', 'directory_projects'],
  ['server/api/v1/directory/projects/members.get.ts', 'directory_projects']
] as const

describe('legacy v1 directory aliases', () => {
  test('apply the same read permission boundary before reading directory data', () => {
    for (const [path, resource] of routes) {
      const content = source(path)
      const handler = content.slice(content.indexOf('export default defineEventHandler'))

      assert.match(content, /import \{ requirePermission \} from '~~\/server\/utils\/checkPermission'/)
      assert.match(handler, new RegExp(`requirePermission\\(event, '${resource}', 'view'\\)`))
    }
  })
})
