import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'

test('sync UI keeps list/event pages separate, preserves return position and discards revoked responses', async () => {
  const source = readFileSync(new URL('../app/components/DirectorySyncReadPage.vue', import.meta.url), 'utf8')
  assert.equal((source.match(/<UPagination/g) || []).length, 2)
  const script = stripTypeScriptTypes(source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!.replace(/^import .*$/gm, '').replace('await refreshAll()', ''))
  const calls: any[] = [], watches: any[] = [], navigations: any[] = []
  const route: any = { path: '/enterprise/directory/sync', fullPath: '/enterprise/directory/sync?page=2', query: { page: '2' } }
  const props: any = { apiPath: '/enterprise/api/directory/sync-jobs', pagePath: '/enterprise/directory/sync', consolePath: '/console/directory/sync' }
  const user: any = { value: 'alice' }, scope: any = { value: 'alice-policy-1' }
  const run = new Function('env', `with(env) { ${script}; return {refreshAll,data,eventData,total,page,eventPage,backPath,pending}; }`)
  const ui = run({
    defineProps: () => props, usePageTitle() {}, ref: (value: any) => ({value}), computed: (fn: any) => ({get value(){return fn()}}),
    useRoute: () => route, useRouter: () => ({push: (to: any) => navigations.push(to)}), useAuth: () => ({user}), useState: () => scope,
    watch: (_source: any, fn: any) => watches.push(fn), onScopeDispose() {}, AbortController,
    $fetch: (path: string, options: any) => new Promise(resolve => calls.push({path,options,resolve}))
  })
  const first = ui.refreshAll()
  assert.equal(calls[0].options.query.page, 2)
  calls[0].resolve({code:0,data:{items:[{jobCode:'J1'}],total:21,page:2,pageSize:20}}); await first
  assert.equal(ui.total.value, 21)
  props.jobCode = 'J1'; route.path += '/J1'; route.query = { eventPage:'2',returnTo:'/enterprise/directory/sync?page=2' }
  assert.equal(ui.backPath.value, '/enterprise/directory/sync?page=2')
  const detail = ui.refreshAll()
  calls[1].resolve({code:0,data:{jobCode:'J1',totalCount:999}})
  await Promise.resolve(); await Promise.resolve()
  assert.deepEqual(calls[2].options.query, {page:2,pageSize:20})
  calls[2].resolve({code:0,data:{items:[{id:21}],total:22,page:2,pageSize:20}}); await detail
  assert.equal(ui.data.value.totalCount, 999)
  assert.equal(ui.eventData.value.total, 22)
  const stale = ui.refreshAll()
  user.value = null; scope.value = ''; await watches[0]()
  assert.equal(calls[3].options.signal.aborted, true)
  calls[3].resolve({code:0,data:{jobCode:'SECRET'}}); await stale
  assert.equal(ui.data.value, null); assert.equal(ui.eventData.value, null)
  route.query.returnTo = 'https://evil.test/enterprise/directory/sync'
  assert.equal(ui.backPath.value, props.pagePath)
})
