import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Script, createContext } from 'node:vm'
import test from 'node:test'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import ts from 'typescript'
import { ref, watch } from 'vue'

function compile(path: string) {
  const filename = new URL(path, import.meta.url).pathname
  const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename })
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: filename })
  const template = compileTemplate({ filename, id: filename, source: descriptor.template!.content, compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  return descriptor
}

test('project work item page and shared create surface compile as complete SFCs', () => {
  compile('../app/pages/projects/[id]/work-items.vue')
  compile('../app/pages/projects/[id]/board.vue')
  compile('../app/components/work-item/WorkItemCreateSurface.vue')
})

test('Host page mode retains the full original creation fields, payload and document links', () => {
  const page = compile('../app/pages/projects/[id]/work-items.vue')
  const source = page.scriptSetup!.content
  assert.match(source, /hostCreate = computed\(\(\) => hosted && route\.query\.create === '1' && canCreateWorkItem\.value\)/)
  assert.match(source, /const createPayload: CreateWorkItemRequest = \{ \.\.\.createForm\.value \}/)
  assert.match(source, /if \(itemId && pendingDocIds\.value\.length > 0\)/)
  assert.match(page.template!.content, /<WorkItemCreateSurface[\s\S]*:page="hostCreate"[\s\S]*<UFormField label="关联文档">/)
  assert.match(page.template!.content, /<ProjectNavbar v-if="!hostCreate">/)
  const board = compile('../app/pages/projects/[id]/board.vue')
  assert.match(board.scriptSetup!.content, /if \(hosted\) \{[\s\S]*create: '1', returnTo: moduleUrl/)
  assert.match(board.template!.content, /<RoutineTaskCreateModal\s+v-if="isRoutineProject && !hosted"/)
})

test('Host routine create opens the page form and department failures stay visible', () => {
  const page = compile('../app/pages/projects/[id]/work-items.vue')
  assert.match(page.scriptSetup!.content, /if \(isRoutineProject\.value\) \{\s*(?:\/\/.*\s*)*if \(hostCreate\.value\) \{\s*initialLoading\.value = false\s*openCreateModal\(\)\s*return/)
  assert.match(page.template!.content, /<UAlert\s+v-if="routineDepartmentsError"/)
  const modal = compile('../app/components/routine/RoutineTaskCreateModal.vue')
  assert.match(modal.template!.content, /<UAlert\s+v-if="departmentsError"/)
  const composable = readFileSync(new URL('../app/composables/useAccessibleDepartments.ts', import.meta.url), 'utf8')
  assert.match(composable, /status === 403 \? 'forbidden' : 'unavailable'/)
  assert.match(composable, /toast\.add\(\{\s*id: toastId/)
  assert.doesNotMatch(composable, /console\.error/)
})

test('page form asks before discarding draft; confirmed save bypasses the guard', async () => {
  const script = compile('../app/components/work-item/WorkItemCreateSurface.vue').scriptSetup!.content.replace(/^import .*$/gm, '')
  const props = { page: true, title: '新建工作目标', draft: 'initial', busy: false }
  let guard: (() => Promise<boolean>) | undefined
  let mounted: (() => void) | undefined
  let exposed: { markSaved: () => void } | undefined
  let accepted = false
  const prompts: unknown[] = []
  const context = createContext({
    ref, watch,
    defineProps: () => props,
    defineEmits: () => () => {},
    defineExpose: (value: { markSaved: () => void }) => { exposed = value },
    onMounted: (callback: () => void) => { mounted = callback },
    onBeforeRouteUpdate: (callback: () => Promise<boolean>) => { guard = callback },
    onBeforeRouteLeave: () => {},
    useConfirm: () => ({ confirm: async (options: unknown) => {
      prompts.push(options)
      return accepted
    } })
  })
  new Script(ts.transpileModule(script, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText).runInContext(context)
  mounted!()
  props.draft = 'changed'
  assert.equal(await guard!(), false)
  assert.equal(prompts.length, 1)
  accepted = true
  assert.equal(await guard!(), true)
  exposed!.markSaved()
  accepted = false
  assert.equal(await guard!(), true)
  assert.equal(prompts.length, 2)
})
