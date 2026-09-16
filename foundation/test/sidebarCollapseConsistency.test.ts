import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const foundationRoot = new URL('../', import.meta.url)
const dashboardSource = readFileSync(new URL('app/composables/useDashboard.ts', foundationRoot), 'utf8')
const sidebarSource = readFileSync(new URL('app/components/LayoutSidebar.vue', foundationRoot), 'utf8')

test('sidebar content and Nuxt UI width share the same effective collapsed state', () => {
  assert.match(sidebarSource, /import\.meta\.server[\s\S]*sidebarLayoutState\.value\?\.collapsed[\s\S]*isSidebarCollapsed\.value = sidebarLayoutState\.value\.collapsed/)
  assert.match(sidebarSource, /watch\(isSidebarCollapsed, \(collapsed\) => \{[\s\S]*sidebarLayoutState\.value = \{[\s\S]*collapsed[\s\S]*\}, \{ immediate: true \}\)/)
})

test('explicit Nuxt UI collapse interactions persist the user preference', () => {
  assert.match(dashboardSource, /function setSidebarCollapsed\(collapsed: boolean, persistPreference = false\)/)
  assert.match(sidebarSource, /function handleSidebarCollapsedUpdate\(collapsed: boolean\) \{[\s\S]*setSidebarCollapsed\(collapsed, true\)/)
  assert.match(sidebarSource, /@update:collapsed="handleSidebarCollapsedUpdate"/)
})
