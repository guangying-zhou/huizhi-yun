import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('Finance list pages hide the redundant page navbar', () => {
  const layout = read('app/layouts/default.vue')
  const page = read('app/pages/[...slug].vue')

  assert.match(layout, /:hide-navbar="hidePageNavbar"/)
  assert.match(layout, /route\.meta\.hidePageNavbar === true/)
  assert.match(page, /definePageMeta\(\{ hidePageNavbar: true \}\)/)
  assert.doesNotMatch(page, /usePageActions\(\)/)
  assert.doesNotMatch(page, /to="#finance-layout-header-actions"/)
})

test('Finance list actions render after the search controls', () => {
  const page = read('app/pages/[...slug].vue')
  const toolbarIndex = page.indexOf('<UDashboardToolbar')
  const searchIndex = page.indexOf('placeholder="搜索编码、客户、合同、项目或说明"')
  const actionsIndex = page.indexOf('ml-auto flex w-full items-center justify-end gap-2 sm:w-auto')

  assert.ok(toolbarIndex >= 0, 'Finance list page must render the shared toolbar')
  assert.ok(searchIndex > toolbarIndex, 'search controls must render inside the toolbar')
  assert.ok(actionsIndex > searchIndex, 'page actions must render after the search controls')
  assert.ok(page.indexOf('v-if="canCreate"', actionsIndex) > actionsIndex)
  assert.ok(page.indexOf('v-if="config.recalculateEndpoint"', actionsIndex) > actionsIndex)
  assert.ok(page.indexOf('v-if="canExportReports"', actionsIndex) > actionsIndex)
})
