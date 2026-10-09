import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parse, compileScript, compileTemplate } from 'vue/compiler-sfc'
import { createCommandIntents } from '../app/utils/commandIntent'

test('deliverable user intent keeps its key through retry and replaces it after completion or payload change', () => {
  const intents = createCommandIntents()
  const first = intents.headers('update:7', { name: 'A' })['Idempotency-Key']
  assert.equal(intents.headers('update:7', { name: 'A' })['Idempotency-Key'], first)
  assert.notEqual(intents.headers('update:7', { name: 'B' })['Idempotency-Key'], first)
  intents.complete('update:7')
  assert.notEqual(intents.headers('update:7', { name: 'A' })['Idempotency-Key'], first)
})

test('changed deliverable pages compile as full Vue SFCs and pass user intent headers', () => {
  for (const relative of [
    '../app/components/target/TargetEditModal.vue',
    '../app/pages/projects/[id]/plan.vue',
    '../app/pages/projects/[id]/board/[workItemId]/execution.vue'
  ]) {
    const filename = fileURLToPath(new URL(relative, import.meta.url))
    const source = readFileSync(filename, 'utf8')
    const parsed = parse(source, { filename })
    assert.deepEqual(parsed.errors, [], relative)
    assert.ok(parsed.descriptor.template, relative)
    const script = compileScript(parsed.descriptor, { id: filename })
    const template = compileTemplate({ filename, id: filename, source: parsed.descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(template.errors, [], relative)
    assert.match(source, /deliverableIntents\.headers\(/, relative)
  }
})

test('work item time entry pages compile as full Vue SFCs and pass user intent headers', () => {
  for (const relative of [
    '../app/pages/projects/[id]/board/[workItemId]/execution.vue',
    '../app/pages/projects/[id]/timesheet.vue'
  ]) {
    const filename = fileURLToPath(new URL(relative, import.meta.url))
    const source = readFileSync(filename, 'utf8')
    const parsed = parse(source, { filename })
    assert.deepEqual(parsed.errors, [], relative)
    assert.ok(parsed.descriptor.template, relative)
    const script = compileScript(parsed.descriptor, { id: filename })
    const template = compileTemplate({ filename, id: filename, source: parsed.descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(template.errors, [], relative)
    assert.match(source, /(?:timeEntryIntents|workTimeIntents)\.headers\(/, relative)
  }
})

test('legacy work item command pages compile and retain keys for retry', () => {
  for (const relative of [
    '../app/pages/projects/[id]/board/[workItemId]/execution.vue',
    '../app/pages/projects/[id]/work-items/[workItemId]/decompose.vue',
    '../app/pages/projects/[id]/work-items.vue',
    '../app/components/routine/RoutineTaskCreateModal.vue'
  ]) {
    const filename = fileURLToPath(new URL(relative, import.meta.url))
    const source = readFileSync(filename, 'utf8')
    const parsed = parse(source, { filename })
    assert.deepEqual(parsed.errors, [], relative)
    assert.ok(parsed.descriptor.template, relative)
    const script = compileScript(parsed.descriptor, { id: filename })
    const template = compileTemplate({ filename, id: filename, source: parsed.descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(template.errors, [], relative)
    assert.match(source, /(?:legacyWorkItemIntents|decomposeIntents|documentIntents)\.headers\(/, relative)
  }
  const source = readFileSync(fileURLToPath(new URL('../app/pages/projects/[id]/work-items/[workItemId]/decompose.vue', import.meta.url)), 'utf8')
  assert.match(source, /receipt_result_unavailable/)
  assert.match(source, /该操作已提交，请刷新查看/)
  assert.doesNotMatch(source, /receipt_result_unavailable[\s\S]{0,300}crypto\.randomUUID/)
})

test('commit relation conflict refreshes the execution list and shows the fixed message', () => {
  const filename = fileURLToPath(new URL('../app/pages/projects/[id]/board/[workItemId]/execution.vue', import.meta.url))
  const source = readFileSync(filename, 'utf8')
  assert.match(source, /relation_changed/)
  assert.match(source, /已被修改或已取消关联，请刷新/)
  assert.match(source, /relation_changed[\s\S]{0,250}loadContext\(\)/)
})
