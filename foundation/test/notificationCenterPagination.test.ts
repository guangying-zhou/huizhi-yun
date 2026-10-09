import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'

test('Host notification center preserves page links and refuses stale detail automatic-read side effects', async () => {
  const source = readFileSync(new URL('../app/components/NotificationCenter.vue', import.meta.url), 'utf8')
  assert.match(source, /共 {{ pageTotal }} 条/)
  const script = stripTypeScriptTypes(source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!.replace(/^import .*$/gm, '').replaceAll('import.meta.client', 'false'))
  const watches: { target: unknown, fn: () => unknown }[] = [], reads: unknown[] = [], routes: unknown[] = [], allReads: unknown[] = []
  const fp = { value: 'P1' }, page = { value: 2 }, status = { value: 'all' }, props = { serverPagination: true, notificationId: 'N1', listPath: '/enterprise/notifications', detailPath: (id: string) => `/enterprise/notifications/${id}`, hosted: true, panelUi: {} }
  let resolveOld!: (value: unknown) => void
  const run = new Function('env', `with(env){${script};return {loadSelectedDetail,selectedDetail,detailErrorStatus,selectNotification,markEverythingRead,status,archiveNotification,page};}`)
  const ui = run({
    defineProps: () => props, withDefaults: (x: unknown) => x, ref: (value: unknown) => ({ value }), computed: (fn: () => unknown) => ({ get value() {
      return fn()
    } }), usePageTitle() {},
    useRouter: () => ({ push: async (to: unknown) => routes.push(to) }), useRoute: () => ({ query: { page: '2', status: 'unread' } }), useListPage: () => ({ page, pageSize: 20 }), useUserApplications: () => ({ apps: { value: [] }, loadApps: async () => {} }),
    useNotifications: () => ({ items: { value: [] }, summary: { value: { unreadCount: 99 } }, loading: { value: false }, error: { value: null }, status, nextCursor: { value: null }, loadSummary: async () => {}, loadNotifications: async () => {}, loadMore: async () => {},
      cacheFingerprint: fp, pageItems: { value: [] }, pageTotal: { value: 41 }, pageLoading: { value: false }, pageError: { value: null }, loadNotificationPage: async () => ({ items: [], total: 20, page: 2, pageSize: 20 }),
      loadDetail: async () => {
        if (fp.value !== 'P1')
          throw Object.assign(Error('denied'), { statusCode: 403 })
        return await new Promise((resolve) => {
          resolveOld = resolve
        })
      }, markRead: async (id: string) => reads.push(id), archive: async () => {}, markAllRead: async (options: unknown) => allReads.push(options) }),
    watch: (target: unknown, fn: () => unknown) => watches.push({ target, fn }), onMounted() {}, onScopeDispose() {}, navigateTo() {}
  })
  const old = ui.loadSelectedDetail()
  fp.value = 'REVOKED'
  watches.find(w => w.target === fp).fn()
  await Promise.resolve()
  await Promise.resolve()
  resolveOld({ notificationId: 'N1', body: 'SECRET' })
  await old
  assert.equal(ui.selectedDetail.value, null)
  assert.equal(ui.detailErrorStatus.value, 403)
  assert.deepEqual(reads, [])
  await ui.selectNotification({ notificationId: 'N2' })
  assert.deepEqual(routes[0], { path: '/enterprise/notifications/N2', query: { page: '2', status: 'unread' } })
  ui.status.value = 'unread'
  await ui.markEverythingRead()
  assert.deepEqual(allReads, [{ status: 'unread' }])
  assert.equal(ui.page.value, 1)
})
