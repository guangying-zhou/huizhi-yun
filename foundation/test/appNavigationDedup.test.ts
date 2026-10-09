import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const foundationRoot = fileURLToPath(new URL('..', import.meta.url))

test('shared layout keeps AppRail on wide screens and AppLauncher on narrow screens', () => {
  const layout = readFileSync(`${foundationRoot}/app/components/LayoutSidebar.vue`, 'utf8')

  assert.match(layout, /appNavigation:\s*'rail'/)
  assert.match(layout, /const showAppRail = computed\(\(\) => \(\s*!applicationShellEmbedded\.value/)
  assert.match(layout, /&& props\.appNavigation === 'rail'/)
  assert.match(layout, /&& !isSidebarDrawerMode\.value/)
  assert.match(layout, /return props\.appNavigation === 'popover' \|\| isSidebarDrawerMode\.value/)
  assert.match(layout, /<AppRail/)
  assert.match(layout, /<AppLauncher v-if="showAppLauncher"/)
  assert.match(layout, /name="app-rail"/)
})

test('application identity reuses the shared cached application list', () => {
  const appInfo = readFileSync(`${foundationRoot}/app/composables/useAppInfo.ts`, 'utf8')

  assert.match(appInfo, /useUserApplications\(\)/)
  assert.match(appInfo, /apps\.value\.find\(app => app\.appCode === appCode\)/)
  assert.doesNotMatch(appInfo, /\$fetch/)
})
