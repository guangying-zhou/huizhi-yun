import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
import { parse, compileScript } from '@vue/compiler-sfc'
import { build } from 'esbuild'
import { computed, createSSRApp, createRenderer, defineComponent, h, nextTick, onUnmounted, ref } from 'vue'
import { renderToString } from '@vue/server-renderer'

const root = resolve(import.meta.dirname, '../..')
const read = p => readFileSync(resolve(root, p), 'utf8')
const filename = resolve(root, 'enterprise/app/components/EnterpriseProjectPageGate.vue')
const script = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, { id: 'gate-test', inlineTemplate: true }).content
const output = (await build({ stdin: { contents: script, resolveDir: resolve(root, 'enterprise/app/components'), sourcefile: filename, loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false, external: ['vue'], plugins: [{ name: 'context-host', setup(builder) {
  builder.onResolve({ filter: /useEnterpriseProjectObjectContext$/ }, () => ({ path: 'context', namespace: 'fixture' }))
  builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: 'export const useProvidedEnterpriseProjectObjectContext = () => globalThis.__cleanupContext', loader: 'js' }))
} }] })).outputFiles[0].text
const mod = { exports: {} }
new Function('require', 'module', 'exports', output)(createRequire(import.meta.url), mod, mod.exports)
const Gate = mod.exports.default

test('actual lazy page gate never mounts/fetches denied or unknown business pages', async () => {
  globalThis.computed = computed
  globalThis.useRoute = () => ({ path: '/aims/projects/263/board' })
  let requests = 0
  const BusinessPage = defineComponent({ setup() {
    requests++
    return () => h('div', '业务页')
  } })
  for (const project of [null, { id: 263, name: '项目', canAccess: true, projectTabAccess: {} }, { id: 264, name: '其它项目', canAccess: true, projectTabAccess: { member: true } }]) {
    globalThis.__cleanupContext = { project: ref(project) }
    await renderToString(createSSRApp({ render: () => h(Gate, null, { default: () => h(BusinessPage) }) }))
    assert.equal(requests, 0)
  }
  globalThis.__cleanupContext = { project: ref({ id: 263, name: '项目', canAccess: true, projectTabAccess: { member: true } }) }
  assert.match(await renderToString(createSSRApp({ render: () => h(Gate, null, { default: () => h(BusinessPage) }) })), /业务页/)
  assert.equal(requests, 1)
})

test('Host hides legacy tab bar while retaining shared project header and avoiding its count fetch', () => {
  const s = read('aims/app/components/project/ProjectNavbar.vue')
  const { descriptor } = parse(s)
  assert.match(descriptor.template.content, /v-if="!hosted" class="flex items-center justify-center/)
  assert.match(descriptor.template.content, /项目编码:|projectSwitcherOpen/)
  assert.match(s, /async function fetchRequirementTargets\(\) \{[\s\S]*?if \(hosted \|\| !projectId.value\) return[\s\S]*?\$fetch/)
  assert.match(read('enterprise/app/app.vue'), /<EnterpriseProjectPageGate><NuxtPage/)
})

test('member card uses existing discovery fact and requirements table has Chinese empty slot', () => {
  const overview = read('aims/layer/pages/enterprise-project-detail.vue')
  assert.match(overview, /canManageMembers = computed\(\(\) => project.value\?\.canEditProject === true\)/)
  assert.match(overview, /canManageMembers \? '管理成员' : '查看成员'/)
  const { descriptor } = parse(read('aims/layer/pages/enterprise-project-requirements.vue'))
  assert.match(descriptor.template.content, /<template #empty>[\s\S]*?<CommonEmptyState[\s\S]*?title="暂无需求"/)
})

test('client gate waits for discovery and unmounts immediately when membership is revoked', async () => {
  globalThis.computed = computed
  globalThis.useRoute = () => ({ path: '/aims/projects/263/board' })
  const project = ref(null)
  globalThis.__cleanupContext = { project }
  let requests = 0
  let unmounted = 0
  const BusinessPage = defineComponent({ setup() {
    requests++
    onUnmounted(() => unmounted++)
    return () => h('div')
  } })
  const node = value => ({ ...value, children: [], parent: null })
  const remove = (child) => {
    if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1)
    child.parent = null
  }
  const renderer = createRenderer({
    patchProp() {},
    insert(child, parent, anchor) {
      remove(child)
      child.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, child)
    },
    remove, createElement: type => node({ type }),
    createText: text => node({ text }), createComment: text => node({ text }),
    setText(child, text) { child.text = text },
    setElementText(child, text) { child.text = text },
    parentNode: child => child.parent,
    nextSibling: child => child.parent?.children[child.parent.children.indexOf(child) + 1] || null
  })
  const app = renderer.createApp({ render: () => h(Gate, null, { default: () => h(BusinessPage) }) })
  app.mount(node({ type: 'root' }))
  try {
    assert.equal(requests, 0)
    project.value = { id: 263, name: '项目', canAccess: true, projectTabAccess: {} }
    await nextTick()
    assert.equal(requests, 0)
    project.value = { ...project.value, projectTabAccess: { member: true } }
    await nextTick()
    assert.equal(requests, 1)
    project.value = { ...project.value, projectTabAccess: {} }
    await nextTick()
    assert.equal(requests, 1)
    assert.equal(unmounted, 1)
  } finally { app.unmount() }
})
