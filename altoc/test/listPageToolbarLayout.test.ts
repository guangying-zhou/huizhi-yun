import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

const listPages = [
  'app/pages/leads/index.vue',
  'app/pages/customers/index.vue',
  'app/pages/opportunities/index.vue',
  'app/pages/quotes/index.vue',
  'app/pages/tenders/index.vue',
  'app/pages/contracts/index.vue',
  'app/pages/payments/index.vue'
]

const createActions = new Map([
  ['app/pages/leads/index.vue', '新建线索'],
  ['app/pages/customers/index.vue', '新建客户'],
  ['app/pages/opportunities/index.vue', '新建商机'],
  ['app/pages/quotes/index.vue', '新建报价'],
  ['app/pages/tenders/index.vue', '新建投标'],
  ['app/pages/contracts/index.vue', '新建合同']
])

test('standard Altoc list pages hide the redundant page navbar', () => {
  const layout = read('app/layouts/default.vue')
  assert.match(layout, /<LayoutSidebar :hide-navbar="hidePageNavbar">/)
  assert.match(layout, /route\.meta\.hidePageNavbar === true/)

  for (const path of listPages) {
    const source = read(path)
    assert.match(source, /definePageMeta\(\{ hidePageNavbar: true \}\)/, path)
    assert.doesNotMatch(source, /usePageActions\(\)/, path)
    assert.doesNotMatch(source, /Teleport to="#altoc-layout-header-actions"/, path)
  }
})

test('list creation and view actions live after the filters in the toolbar', () => {
  for (const [path, actionLabel] of createActions) {
    const source = read(path)
    const toolbarIndex = source.indexOf('altoc-list-toolbar')
    const actionIndex = source.indexOf(`label="${actionLabel}"`)

    assert.ok(toolbarIndex >= 0, `${path} must render the standard toolbar`)
    assert.ok(actionIndex > toolbarIndex, `${path} must place ${actionLabel} inside the toolbar`)
    assert.match(source.slice(toolbarIndex, actionIndex), /ml-auto[^"]*justify-end/)
  }

  const opportunities = read('app/pages/opportunities/index.vue')
  assert.ok(opportunities.indexOf('aria-label="列表视图"') > opportunities.indexOf('altoc-list-toolbar'))
  assert.ok(opportunities.indexOf('aria-label="看板视图"') > opportunities.indexOf('altoc-list-toolbar'))
})
