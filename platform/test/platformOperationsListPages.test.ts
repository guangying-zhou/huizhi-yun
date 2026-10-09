import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

const lists = [
  { route: 'invoices', table: 'platform_invoices', endpoint: 'invoices' },
  { route: 'payments', table: 'platform_payments', endpoint: 'payments' },
  { route: 'tickets', table: 'platform_tickets', endpoint: 'tickets' },
  { route: 'announcements', table: 'platform_announcements', endpoint: 'announcements' },
  { route: 'accounts', table: 'platform_accounts', endpoint: 'accounts' },
  { route: 'feature-flags', table: 'platform_feature_flags', endpoint: 'feature-flags' },
  { route: 'audit', table: 'platform_audit_logs', endpoint: 'audit' }
]

describe('Platform 管理菜单读取页契约', () => {
  test('布局中每个菜单都有对应页面', () => {
    const layout = source('app/layouts/platform.vue')
    for (const item of [...lists, { route: 'platform-roles' }]) {
      assert.match(layout, new RegExp(`to: '/admin/${item.route}'`))
      assert.equal(
        existsSync(new URL(`../app/pages/admin/${item.route}.vue`, import.meta.url)),
        true,
        `${item.route} page is missing`
      )
    }
  })

  for (const item of lists) {
    test(`${item.route} 页面与分页 API 一致`, () => {
      const page = source(`app/pages/admin/${item.route}.vue`)
      const endpoint = source(`server/api/platform/ops/${item.endpoint}.get.ts`)
      assert.match(page, new RegExp(`/api/platform/ops/${item.endpoint}`))
      assert.match(endpoint, new RegExp(`FROM ${item.table}`))
      assert.match(endpoint, /parsePagination\(query\)/)
      assert.match(endpoint, /LIMIT \? OFFSET \?/)
    })
  }

  test('平台角色页复用平台角色读取 API', () => {
    const page = source('app/pages/admin/platform-roles.vue')
    assert.match(page, /\/api\/platform\/ops\/roles/)
    assert.match(source('server/api/platform/_handlers/roles.get.ts'), /FROM platform_roles/)
  })
})
