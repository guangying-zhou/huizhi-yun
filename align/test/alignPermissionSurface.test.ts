import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { matchRouteRule, menus, resources, routeRules } from '../app/config/permissions.ts'

const sensitiveActions = new Set(['approve', 'confirm', 'export', 'deploy'])

function walkFiles(root: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(root)) {
    const path = resolve(root, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) {
      files.push(...walkFiles(path))
    } else {
      files.push(path)
    }
  }
  return files
}

function collectMenuActions(items: typeof menus[number]): string[] {
  const actions: string[] = []
  for (const item of items) {
    if (typeof item.action === 'string') actions.push(item.action)
    if (Array.isArray(item.children)) actions.push(...collectMenuActions(item.children))
  }
  return actions
}

describe('Align permission surface', () => {
  test('keeps the paused module on dashboard and admin resources only', () => {
    assert.deepEqual(
      resources.map(resource => resource.code).sort(),
      ['admin', 'dashboard']
    )
  })

  test('does not expose approve, confirm, export or deploy permission actions', () => {
    const routeActions = routeRules.map(rule => rule.action)
    const menuActions = menus.flatMap(group => collectMenuActions(group))
    const resourceActions = resources.flatMap((resource) => {
      const actions = (resource as { actions?: unknown }).actions
      return Array.isArray(actions) ? actions.filter(action => typeof action === 'string') as string[] : []
    })
    const actions = [...routeActions, ...menuActions, ...resourceActions]

    for (const action of actions) {
      assert.equal(
        sensitiveActions.has(action),
        false,
        `Align scaffold should not expose sensitive action ${action}`
      )
    }
  })

  test('keeps admin pages behind admin permission', () => {
    assert.deepEqual(routeRules, [
      { pattern: '/admin', resource: 'admin', action: 'admin' },
      { pattern: '/admin/**', resource: 'admin', action: 'admin' }
    ])
    assert.equal(matchRouteRule('/'), null)
    assert.deepEqual(matchRouteRule('/admin'), { pattern: '/admin', resource: 'admin', action: 'admin' })
    assert.deepEqual(matchRouteRule('/admin/settings'), { pattern: '/admin/**', resource: 'admin', action: 'admin' })
  })

  test('does not introduce a platform manifest while the module is paused', () => {
    assert.equal(existsSync(resolve(import.meta.dirname, '../app.manifest.json')), false)
  })

  test('does not add sensitive business API filenames while module is paused', () => {
    const apiRoot = resolve(import.meta.dirname, '../server/api')
    const apiFiles = walkFiles(apiRoot)
      .map(file => relative(apiRoot, file))
      .filter(file => /\.(get|post|put|patch|delete)\.ts$/.test(file))

    assert.ok(apiFiles.length > 0)

    for (const file of apiFiles) {
      assert.doesNotMatch(file, /(^|[/.:-])(approve|confirm|export|deploy)([/.:-]|$)/)
    }
  })

  test('has no module-owned business notification route or sender', () => {
    assert.equal(existsSync(resolve(import.meta.dirname, '../server/api/notifications.ts')), false)
    assert.equal(existsSync(resolve(import.meta.dirname, '../app/components/NotificationsSlideover.vue')), false)

    const wecomSource = readFileSync(resolve(import.meta.dirname, '../server/utils/wecom.ts'), 'utf8')
    assert.match(wecomSource, /auth\/getuserinfo/)
    assert.doesNotMatch(wecomSource, /message\/send|sendNotification|textcard/)
  })
})
