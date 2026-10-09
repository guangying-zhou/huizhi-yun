import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { normalizeProjectModuleConfig, projectModuleKeys, projectModuleMeta, toPersistedProjectModuleConfig } from '../app/utils/projectModuleConfig'
import { projectWorkflowActionConfigs } from '../app/utils/projectWorkflow'

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const files = ['../layer/pages/enterprise-project-edit.vue', ...['ProjectSettingsOverview', 'ProjectModuleSettings', 'ProjectLifecycleSettings'].map(name => `../app/components/project/${name}.vue`)]
for (const file of files) test(`R3 complete SFC compiles: ${file}`, () => {
  const filename = new URL(file, import.meta.url).pathname
  const { descriptor, errors } = parse(read(file), { filename })
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'r3-project-settings' })
  const template = compileTemplate({ filename, id: 'r3-project-settings', source: descriptor.template!.content, compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
})

function setup(name: string, props: Record<string, unknown>, fetch: (path: string, options?: Record<string, unknown>) => Promise<unknown>, expose: string, can = true) {
  const source = parse(read(`../app/components/project/${name}.vue`)).descriptor.scriptSetup!.content.replace(/^import .*$/gm, '')
  const events: string[] = []
  const watchers: (() => void)[] = []
  const ref = (value: unknown) => ({ value })
  const context = vm.createContext({
    useState: (_key: string, init: () => unknown) => ref(init()),
    defineProps: () => props, defineEmits: () => (event: string) => events.push(event), ref, reactive: (value: unknown) => value,
    computed: (get: () => unknown) => ({ get value() { return get() } }), watch: (_get: unknown, fn: () => void) => watchers.push(fn), onMounted: () => {},
    useAimsModule: () => ({ moduleUrl: (path: string) => `/aims${path}`, cacheKey: (key: string) => key }), useToast: () => ({ add: () => {} }),
    useAuth: () => ({ user: ref('manager') }),
    usePermissions: () => ({ hasPermission: (_resource: string, action: string) => can && ['edit', 'close'].includes(action) }), useConfirm: () => ({ confirm: async () => true }),
    crypto: { randomUUID: () => 'stable-intent' }, normalizeProjectModuleConfig, projectModuleKeys, projectModuleMeta, toPersistedProjectModuleConfig, projectWorkflowActionConfigs, $fetch: fetch
  })
  vm.runInContext(ts.transpileModule(`${source}\nglobalThis.state = {${expose}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
  return { state: context.state, events, watchers }
}

test('module save retries frozen configuration with same key, retains draft and cannot write when read-only', async () => {
  const requests: { path: string, key: string, body: string }[] = []
  const props = { projectId: '7', category: 'routine', config: null, expectedVersion: 'a'.repeat(64), canManage: true }
  const { state, watchers } = setup('ProjectModuleSettings', props, async (path, options) => {
    requests.push({ path, key: (options!.headers as Record<string, string>)['Idempotency-Key']!, body: JSON.stringify(options!.body) })
    if (requests.length === 1) throw new TypeError('Failed to fetch /private/path')
    return { code: 0 }
  }, 'draft, save, reset, error, operation')
  assert.equal(state.draft.milestones, false)
  state.draft.requirements = true
  await state.save()
  assert.match(state.error.value, /保存结果未确认/)
  assert.doesNotMatch(state.error.value, /fetch|private/)
  props.config = { requirements: false }
  watchers.forEach(fn => fn())
  state.reset()
  assert.equal(state.draft.requirements, true)
  await state.save()
  assert.deepEqual(requests[1], requests[0])
  assert.equal(requests[0]!.path, '/aims/api/v1/projects/7/modules')
  const denied = setup('ProjectModuleSettings', { ...props, canManage: false }, async () => {
    throw Error('unexpected write')
  }, 'draft, save')
  denied.state.draft.milestones = true
  await denied.state.save()
})

test('module conflict preserves draft even when a subsequent refresh returns another configuration', async () => {
  const props = { projectId: '7', category: 'custom_dev', config: null, expectedVersion: 'a'.repeat(64), canManage: true }
  const { state, watchers } = setup('ProjectModuleSettings', props, async () => {
    throw { statusCode: 409 }
  }, 'draft, save, error')
  state.draft.releases = true
  await state.save()
  props.config = { releases: false }
  watchers.forEach(fn => fn())
  assert.equal(state.draft.releases, true)
  assert.match(state.error.value, /已被他人修改.*草稿已保留/)
})

test('lifecycle request only submits action/version/comment and retries the same intent; callbacks only refresh', async () => {
  const requests: { method?: unknown, body: string, key?: string }[] = []
  let writes = 0
  const { state } = setup('ProjectLifecycleSettings', { projectId: '7', name: '标记项目', status: 'active', expectedVersion: 'a'.repeat(64), canManage: true }, async (_path, options) => {
    if (options?.method === 'POST') {
      requests.push({ method: options.method, key: (options.headers as Record<string, string>)['Idempotency-Key'], body: JSON.stringify(options.body) })
      if (++writes === 1) throw { statusCode: 503 }
    }
    return { code: 0, data: null }
  }, 'action, comment, submit, operation, error, refresh')
  state.action.value = 'finish'
  state.comment.value = '完成交付'
  await state.submit()
  assert.match(state.error.value, /沿用同一请求/)
  await state.submit()
  assert.deepEqual(requests[1], requests[0])
  const body = JSON.parse(requests[0]!.body)
  assert.deepEqual(Object.keys(body).sort(), ['actionCode', 'comment', 'expectedVersion'])
  assert.equal(body.actionCode, 'finish')
  await state.refresh()
  assert.equal(writes, 2, 'reading approved results never writes lifecycle status')
  const source = read('../app/components/project/ProjectLifecycleSettings.vue')
  assert.doesNotMatch(source, /updateProject|onApproved|lifecycleStatus:\s*['"]|archived/)
  assert.match(source, /code === 'finish' \? 'close' : 'edit'/)
  const denied = setup('ProjectLifecycleSettings', { projectId: '7', name: '项目', status: 'active', expectedVersion: 'a'.repeat(64), canManage: true }, async () => {
    throw Error('unexpected write')
  }, 'comment, submit', false)
  denied.state.comment.value = 'reason'
  await denied.state.submit()
})

test('settings restores full readonly data, associations and independent members without Account or repository creation', () => {
  const overview = read('../app/components/project/ProjectSettingsOverview.vue')
  for (const field of ['项目编码', '内部代号', '客户名称', '商机', '合同', '开始日期', '结束日期', '业务领域', '密级']) assert.ok(overview.includes(field), field)
  assert.match(overview, /\/members`/)
  assert.match(overview, /如需新建仓库请到 GitLab 创建后再关联/)
  assert.doesNotMatch(overview, /\/api\/account|createOnGitlab/)
  assert.match(overview, /tone: 'danger'/)
  const page = read('../layer/pages/enterprise-project-edit.vue')
  assert.match(page, /<ProjectSettingsOverview/)
  assert.match(page, /<ProjectModuleSettings/)
  assert.match(page, /<ProjectLifecycleSettings/)
  assert.match(page, /<ProjectAccessControlFields/)
  assert.match(page, /const basicDraft = \{ \.\.\.form \}/)
  assert.match(page, /const accessDraft =/)
})

test('an already frozen request survives later permission failure and reopening without changing the intent', async () => {
  const { state } = setup('ProjectLifecycleSettings', { projectId: '7', name: '项目', status: 'active', expectedVersion: 'a'.repeat(64), canManage: true }, async () => {
    throw { statusCode: 403, data: { data: { requestFrozen: true } } }
  }, 'action, comment, submit, operation, open, begin')
  state.action.value = 'finish'
  state.comment.value = '结项说明'
  await state.submit()
  assert.equal(state.operation.value.key, 'project-7-finish-stable-intent')
  state.open.value = false
  state.begin('pause')
  assert.equal(state.action.value, 'finish')
  assert.equal(state.comment.value, '结项说明')
  assert.equal(state.operation.value.body.actionCode, 'finish')
})
