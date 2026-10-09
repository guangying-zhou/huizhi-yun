import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { reactive, ref, computed } from 'vue'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { parse as parseTemplate, type RootNode, type TemplateChildNode } from '@vue/compiler-dom'

const root = resolve(import.meta.dirname, '../..')
const file = resolve(root, 'foundation/app/components/RemoteObjectSelectMenu.vue')
const source = readFileSync(file, 'utf8')

test('shared popup compiles, owns scroll/retry controls and reads only while open and enabled', () => {
  const { descriptor, errors } = parse(source)
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'remote' })
  assert.deepEqual(compileTemplate({ source: descriptor.template!.content, filename: file, id: 'remote', compilerOptions: { bindingMetadata: script.bindings } }).errors, [])
  const code = ts.transpileModule(script.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const props = reactive({ items: [], modelValue: '', searchTerm: '', hasMore: true, loading: false, disabled: false, error: '' })
  let scroll: (() => void) | undefined, canLoad: (() => boolean) | undefined
  const events: string[] = []
  const state = { exports: {} as { default: { setup: (p: unknown, ctx: unknown) => Record<string, unknown> } }, ref, computed,
    require: (name: string) => name === 'vue'
      ? { defineComponent: (x: unknown) => x, mergeModels: (a: object, b: object) => ({ ...a, ...b }), useModel: (_p: unknown, key: string) => ref(key === 'modelValue' ? '' : '') }
      : name === '@vueuse/core'
        ? { useInfiniteScroll: (_target: unknown, cb: () => void, options: { canLoadMore: () => boolean }) => {
            scroll = cb
            canLoad = options.canLoadMore
          } }
        : { default: {} }
  }
  runInNewContext(code, state)
  const bindings = state.exports.default.setup(props, { expose: () => {}, emit: (event: string) => events.push(event) }) as { open: { value: boolean } }
  assert.equal(canLoad!(), false, 'closed popup cannot consume additional pages')
  bindings.open.value = true
  assert.equal(canLoad!(), true)
  scroll!()
  assert.deepEqual(events, ['loadMore'])
  for (const key of ['loading', 'disabled'] as const) {
    props[key] = true
    assert.equal(canLoad!(), false)
    props[key] = false
  }
  props.error = 'failure'
  assert.equal(canLoad!(), false, 'failed pages require explicit retry')
  props.error = ''
  props.hasMore = false
  assert.equal(canLoad!(), false)
  assert.match(source, /#content-bottom[\s\S]*data-remote-select-footer[\s\S]*重试加载/)
  assert.doesNotMatch(source, /UPagination|共 \{\{/)
})

test('Host and layer dropdown fields cannot grow a sibling pagination or retry area', () => {
  const files: string[] = []
  function scan(dir: string) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.nuxt', '.output'].includes(e.name)) continue
      const path = resolve(dir, e.name)
      if (e.isDirectory()) scan(path)
      else if (e.name.endsWith('.vue')) files.push(path)
    }
  }
  for (const module of ['enterprise', 'foundation', 'aims', 'assets', 'finance', 'people', 'altoc', 'codocs']) scan(resolve(root, module, 'app'))
  const selectors = new Set(['USelectMenu', 'UInputMenu', 'RemoteObjectSelectMenu', 'AltocBusinessObjectSelect', 'FinanceBusinessObjectSelect', 'W3QueueObjectSelect', 'RemoteAssetObjectSelect'])
  function visit(node: RootNode | TemplateChildNode, insidePopup = false): { select: boolean, externalPage: boolean } {
    const element = node.type === 1 ? node : null
    if (element?.tag === 'template' && element.props.some(p => p.type === 7 && p.name === 'slot' && p.arg?.type === 4 && ['content', 'content-bottom'].includes(p.arg.content))) insidePopup = true
    const children = 'children' in node && Array.isArray(node.children) ? node.children.map(child => visit(child as TemplateChildNode, insidePopup)) : []
    const select = Boolean(element && selectors.has(element.tag)) || children.some(x => x.select)
    const externalPage = (!insidePopup && element?.tag === 'UPagination') || children.some(x => x.externalPage)
    if (element?.tag === 'UFormField') assert.ok(!(select && externalPage), `dropdown field contains external pagination: ${currentFile}`)
    return { select, externalPage }
  }
  let currentFile = ''
  for (const path of files) {
    currentFile = path
    const template = parse(readFileSync(path, 'utf8')).descriptor.template?.content
    if (template) visit(parseTemplate(template))
  }
  for (const path of ['enterprise/app/components/AltocBusinessObjectSelect.vue', 'finance/app/components/host/FinanceBusinessObjectSelect.vue', 'finance/app/components/host/W3QueueObjectSelect.vue', 'assets/app/components/assets/RemoteAssetObjectSelect.vue']) {
    const text = readFileSync(resolve(root, path), 'utf8')
    assert.match(text, /import RemoteObjectSelectMenu/)
    assert.doesNotMatch(text, /UPagination|<USelectMenu|共 \{\{/)
  }
})
