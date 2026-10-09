import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { projectPageFailure } from '../app/utils/projectPageFailure'

test('project refusals have useful safe copy without fetch URLs', () => {
  for (const [status, expected] of [[401, '登录'], [403, '权限'], [404, '不存在'], [410, '已下线']] as const) {
    assert.ok(projectPageFailure({ statusCode: status, message: 'GET /secret/path failed' }).includes(expected))
    assert.ok(!projectPageFailure({ statusCode: status }).includes('/secret'))
  }
  assert.equal(projectPageFailure(new Error('raw fetch failed')), '项目数据暂不可用，请稍后重试')
})
test('member revalidation clears old object rows and write entry verdict before reading', () => {
  const source = readFileSync(new URL('../layer/pages/enterprise-project-members.vue', import.meta.url), 'utf8')
  const refresh = source.slice(source.indexOf('async function refresh()'))
  assert.ok(refresh.indexOf('canManage.value = false') < refresh.indexOf('await $fetch'))
  assert.ok(refresh.indexOf('items.value = []') < refresh.indexOf('await $fetch'))
  assert.match(source, /v-if="canManage && !loading && !error"/)
  assert.match(source, /<UTable\s+v-if="!error"/)
})

test('failed member detail/read revokes the old manager UI and keeps no previous rows', async () => {
  const { default: ts } = await import('typescript')
  const { default: vm } = await import('node:vm')
  const source = readFileSync(new URL('../layer/pages/enterprise-project-members.vue', import.meta.url), 'utf8')
  const refresh = source.slice(source.indexOf('let readGeneration'), source.indexOf('onScopeDispose'))
  for (const failAt of ['detail', 'members']) {
    const state = {
      loading: { value: false }, error: { value: '' }, canManage: { value: true },
      items: { value: [{ uid: 'old-project-user' }] }, total: { value: 1 },
      projectId: { value: '2' }, page: { value: 1 }, pageSize: 20, debounced: { value: '' },
      moduleUrl: (path: string) => path, projectPageFailure,
      $fetch: async (path: string) => {
        if (failAt === 'detail' || path.endsWith('/members')) throw { statusCode: 403 }
        return { code: 0, data: { canEditProject: true } }
      }
    }
    vm.createContext(state)
    await vm.runInContext(ts.transpile(`${refresh}\nrefresh()`, { target: ts.ScriptTarget.ES2022 }), state)
    assert.equal(state.canManage.value, false)
    assert.equal(state.loading.value, false)
    assert.equal(state.total.value, 0)
    assert.equal(state.items.value.length, 0)
    assert.ok(state.error.value.includes('权限'))
  }
})

test('project and portfolio document reads never surface raw fetch paths and keep opaque denials', () => {
  for (const path of ['../app/pages/project-documents.vue', '../layer/pages/enterprise-portfolio-detail.vue', '../layer/pages/enterprise-portfolio-document-open.vue']) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.ok(source.includes('projectPageFailure'))
    assert.ok(!source.includes('failure.message'))
  }
  const source = readFileSync(new URL('../layer/pages/enterprise-portfolio-document-open.vue', import.meta.url), 'utf8')
  assert.ok(source.includes('[403, 404].includes'))
  assert.ok(source.includes('文档不存在，或你没有查看权限。'))
})

test('member rows have a compact mobile presentation without squeezed table actions', () => {
  const source = readFileSync(new URL('../layer/pages/enterprise-project-members.vue', import.meta.url), 'utf8')
  assert.match(source, /class="hidden sm:block"/)
  assert.match(source, /<ul v-else-if="items.length"/)
  assert.match(source, /:key="member.id"/)
  assert.match(source, /write\('remove', member.uid\)/)
})
