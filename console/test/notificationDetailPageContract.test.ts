import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('Console provides both an in-app notification modal and a unified deep-link message center', () => {
  const indexPage = readFileSync(new URL('../app/pages/notifications/index.vue', import.meta.url), 'utf8')
  const detailPage = readFileSync(new URL('../app/pages/notifications/[notificationId].vue', import.meta.url), 'utf8')
  const center = readFileSync(new URL('../app/components/NotificationCenter.vue', import.meta.url), 'utf8')
  const layout = readFileSync(new URL('../app/layouts/default.vue', import.meta.url), 'utf8')
  const appLastRoute = readFileSync(new URL('../../foundation/app/utils/appLastRoute.ts', import.meta.url), 'utf8')
  const slideover = readFileSync(new URL('../../foundation/app/components/NotificationsSlideover.vue', import.meta.url), 'utf8')

  assert.match(indexPage, /<NotificationCenter\s*\/>/)
  assert.match(detailPage, /<NotificationCenter :notification-id="notificationId"\s*\/>/)
  assert.match(center, /const detail = await loadDetail\(notificationId\)/)
  assert.match(center, /resolveNotificationActionUrl\(selectedDetail\.value, apps\.value, window\.location\.origin\)/)
  assert.match(center, /await router\.push\(`\/notifications\/\$\{encodeURIComponent\(item\.notificationId\)\}`\)/)
  assert.match(center, /消息列表/)
  assert.match(center, /消息内容/)
  assert.match(center, /返回消息列表/)
  assert.match(center, /前往处理/)
  assert.match(layout, /label: '消息中心'[\s\S]*to: '\/notifications'/)
  assert.match(layout, /route\.path === '\/notifications'/)
  assert.match(layout, /route\.path\.startsWith\('\/notifications\/'\)/)
  assert.match(appLastRoute, /CONSOLE_WORKSPACE_ROUTE_PREFIXES[\s\S]*'\/notifications'/)

  assert.match(slideover, /<UModal\b/)
  assert.match(slideover, /const detail = await loadDetail\(item\.notificationId\)/)
  assert.match(slideover, /resolveNotificationActionUrl\(selectedDetail\.value, apps\.value, window\.location\.origin\)/)
  assert.doesNotMatch(slideover, /resolveNotificationDetailPageUrl\(/)
})
