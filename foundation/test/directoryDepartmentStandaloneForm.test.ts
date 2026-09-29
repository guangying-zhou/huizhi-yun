import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Script, createContext } from 'node:vm'
import test from 'node:test'
import ts from 'typescript'
import { ref, reactive, computed, watch, nextTick } from 'vue'
import { createConsoleMutationIntent } from '../shared/utils/consoleMutationIntent'

function department(page: boolean, initialDepartment?: Record<string, unknown>) {
  const source = readFileSync(new URL('../app/components/DirectoryDepartmentEditor.vue', import.meta.url), 'utf8')
  const script = source.split('<script setup lang="ts">')[1]!.split('</script>')[0]!.replace(/^import .*$/gm, '')
  const calls: { path: string, method: string, body: Record<string, unknown>, headers: Record<string, string> }[] = []
  const events: unknown[][] = []
  const props = { page, initialDepartment, apiPath: '/enterprise/api/directory/departments', departments: [], canEdit: true, refresh: async () => {} }
  let failure = false
  let saved = 0
  const context = createContext({
    ref, reactive, computed, watch,
    defineProps: () => props,
    defineEmits: () => (...args: unknown[]) => { events.push(args) },
    useToast: () => ({ add: () => {} }),
    useConfirm: () => ({ confirm: async () => true }),
    createConsoleMutationIntent: (prefix: string) => createConsoleMutationIntent(prefix, () => 'department-intent'),
    $fetch: async (path: string, options: { method: string, body: Record<string, unknown>, headers: Record<string, string> }) => {
      calls.push({ path, ...options })
      if (failure) throw new Error('response lost')
      return {}
    }
  })
  const code = ts.transpileModule(`${script}\nglobalThis.editor = { form, surface, modalOpen, locked, submitDepartment, retry, openCreateDepartment }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  new Script(code).runInContext(context)
  const editor = context.editor as { form: Record<string, unknown>, surface: { value: unknown }, modalOpen: { value: boolean }, locked: { value: boolean }, submitDepartment: () => Promise<void>, retry: () => Promise<void>, openCreateDepartment: () => void }
  editor.surface.value = { markSaved: () => {
    saved += 1
  } }
  return { editor, calls, events, props, fail: (value: boolean) => {
    failure = value
  }, saved: () => saved }
}

test('Host create keeps draft and original intent after response loss, then returns on confirmed retry', async () => {
  const form = department(true)
  assert.equal(form.editor.modalOpen.value, true)
  Object.assign(form.editor.form, { deptCode: 'D1', name: '部门草稿' })
  await nextTick()
  form.fail(true)
  await form.editor.submitDepartment()
  assert.equal(form.editor.form.name, '部门草稿')
  assert.equal(form.editor.locked.value, true)
  assert.equal(form.saved(), 0)
  assert.equal(form.events.length, 0)
  form.fail(false)
  await form.editor.retry()
  await nextTick()
  assert.equal(form.calls.length, 2)
  assert.deepEqual(form.calls[0], form.calls[1])
  assert.equal(form.calls[1]!.method, 'POST')
  assert.equal(form.saved(), 1)
  assert.equal(form.events[0]![0], 'closed')
})

test('Host edit preserves object code and PATCH diff; denied edits do not send', async () => {
  const form = department(true, { deptCode: 'D2', name: '原部门', parentId: null, sortOrder: 100 })
  assert.equal(form.editor.form.deptCode, 'D2')
  form.editor.form.description = '新说明'
  form.props.canEdit = false
  await form.editor.submitDepartment()
  assert.equal(form.calls.length, 0)
  form.props.canEdit = true
  await form.editor.submitDepartment()
  assert.equal(form.calls[0]!.path, '/enterprise/api/directory/departments/D2')
  assert.equal(form.calls[0]!.method, 'PATCH')
  assert.deepEqual(form.calls[0]!.body, { description: '新说明' })
})

test('Console default stays closed until the original drawer action and does not emit page navigation', async () => {
  const form = department(false)
  assert.equal(form.editor.modalOpen.value, false)
  form.editor.openCreateDepartment()
  await nextTick()
  Object.assign(form.editor.form, { deptCode: 'D3', name: '独立控制台部门' })
  await form.editor.submitDepartment()
  await nextTick()
  assert.equal(form.calls[0]!.method, 'POST')
  assert.equal(form.events.length, 0)
})

test('directory page protects drafts while drawer mode keeps the original routing behavior', async () => {
  const source = readFileSync(new URL('../app/components/DirectoryFormSurface.vue', import.meta.url), 'utf8')
  const script = source.split('<script setup lang="ts">')[1]!.split('</script>')[0]!.replace(/^import .*$/gm, '')
  for (const page of [false, true]) {
    const props = { page, title: '编辑目录部门', draft: 'original', busy: false }
    let guard: (() => Promise<boolean>) | undefined
    let exposed: { markSaved: () => void } | undefined
    let accept = false
    const questions: Record<string, unknown>[] = []
    const context = createContext({
      ref,
      defineProps: () => props,
      defineEmits: () => () => {},
      defineExpose: (value: { markSaved: () => void }) => { exposed = value },
      onBeforeRouteLeave: (value: () => Promise<boolean>) => { guard = value },
      useConfirm: () => ({ confirm: async (options: Record<string, unknown>) => {
        questions.push(options)
        return accept
      } })
    })
    new Script(ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText).runInContext(context)
    if (!page) {
      assert.equal(guard, undefined)
      continue
    }
    assert.equal(await guard!(), true)
    props.draft = 'unsaved'
    assert.equal(await guard!(), false)
    assert.equal(props.draft, 'unsaved')
    assert.match(String(questions[0]!.message), /编辑目录部门.*未保存.*丢失/)
    props.busy = true
    const count = questions.length
    assert.equal(await guard!(), false)
    assert.equal(questions.length, count)
    props.busy = false
    accept = true
    assert.equal(await guard!(), true)
    props.busy = true
    exposed!.markSaved()
    assert.equal(await guard!(), true)
  }
})
