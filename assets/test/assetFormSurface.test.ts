import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Script, createContext } from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

function surface(page: boolean) {
  const source = readFileSync(new URL('../app/components/assets/AssetFormSurface.vue', import.meta.url), 'utf8')
  const script = source.split('<script setup lang="ts">')[1]!.split('</script>')[0]!.replace(/^import .*$/gm, '')
  const props = { page, title: '编辑产品主档', draft: '{"name":"原名称"}', busy: false }
  let leave: () => Promise<boolean>
  let saved: { markSaved: () => void }
  let answer = false
  const questions: Record<string, string>[] = []
  const context = createContext({
    defineProps: () => props,
    defineEmits: () => () => {},
    ref: (value: unknown) => ({ value }),
    onMounted: (callback: () => void) => callback(),
    onBeforeRouteLeave: (callback: () => Promise<boolean>) => { leave = callback },
    defineExpose: (value: { markSaved: () => void }) => { saved = value },
    useConfirm: () => ({ confirm: async (options: Record<string, string>) => {
      questions.push(options)
      return answer
    } })
  })
  const code = ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  new Script(code).runInContext(context)
  return { props, questions, leave: () => leave!(), markSaved: () => saved!.markSaved(), accept: () => {
    answer = true
  } }
}

test('page draft guard preserves cancelled/failed edits and permits confirmed discard', async () => {
  const form = surface(true)
  assert.equal(await form.leave(), true)
  form.props.draft = '{"name":"草稿"}'
  assert.equal(await form.leave(), false)
  assert.equal(form.props.draft, '{"name":"草稿"}')
  assert.match(form.questions[0]!.message!, /编辑产品主档.*未保存.*丢失/)
  form.props.busy = true
  const count = form.questions.length
  assert.equal(await form.leave(), false)
  assert.equal(form.questions.length, count)
  form.props.busy = false
  // A failed submission never calls markSaved: its draft remains protected.
  assert.equal(await form.leave(), false)
  form.accept()
  assert.equal(await form.leave(), true)
})

test('successful save can return while submit finally is still pending; standalone modal is unchanged', async () => {
  const form = surface(true)
  form.props.draft = 'changed'
  form.props.busy = true
  form.markSaved()
  assert.equal(await form.leave(), true)
  assert.equal(form.questions.length, 0)
  const modal = surface(false)
  modal.props.draft = 'changed'
  modal.props.busy = true
  assert.equal(await modal.leave(), true)
  assert.equal(modal.questions.length, 0)
})

async function formPage(id: string, returnTo: unknown) {
  const source = readFileSync(new URL('../layer/pages/product-form.vue', import.meta.url), 'utf8')
  const script = source.split('<script setup lang="ts">')[1]!.split('</script>')[0]!.replace(/^import .*$/gm, '')
  const calls: { url: string, immediate: boolean }[] = []
  const context = createContext({
    definePageMeta: () => {},
    useRoute: () => ({ params: { id }, query: { returnTo } }),
    useAssetsModule: () => ({ moduleUrl: (path: string) => `/assets${path}`, cacheKey: (key: string) => key }),
    computed: (read: () => unknown) => ({ get value() { return read() } }),
    useFetch: async (url: () => string, options: { immediate: boolean }) => {
      calls.push({ url: url(), immediate: options.immediate })
      return { data: null, pending: false, error: null, refresh: () => {} }
    },
    navigateTo: (path: string) => path
  })
  const code = ts.transpileModule(`${script}\nglobalThis.formPageResult = { returnPath: returnPath.value, leave }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  await new Script(`(async () => { ${code} })()`).runInContext(context)
  return { result: context.formPageResult as { returnPath: string, leave: () => string }, calls }
}

test('Host form rejects external/unrelated returns and preserves the original source query', async () => {
  for (const value of ['https://outside.example/assets/products', '//outside.example/assets/products', '/enterprise/profile', ['/assets/products']]) {
    const form = await formPage('', value)
    assert.equal(form.result.returnPath, '/assets/products')
    assert.equal(form.calls[0]!.immediate, false)
  }
  const create = await formPage('', '/assets/products?page=3&search=产品')
  assert.equal(create.result.leave(), '/assets/products?page=3&search=产品')
  const edit = await formPage('42', '/assets/products/42?tab=relations')
  assert.equal(edit.result.leave(), '/assets/products/42?tab=relations')
  assert.equal(edit.calls[0]!.url, '/assets/api/v1/products/42')
  assert.equal(edit.calls[0]!.immediate, true)
  const unrelated = await formPage('42', '/assets/products/43')
  assert.equal(unrelated.result.returnPath, '/assets/products/42')
})
