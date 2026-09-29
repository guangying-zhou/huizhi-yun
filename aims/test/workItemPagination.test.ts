import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { parse, compileScript, compileTemplate } from 'vue/compiler-sfc'

function compilePage(path: string) {
  const filename = fileURLToPath(new URL(path, import.meta.url))
  const source = readFileSync(filename, 'utf8')
  const parsed = parse(source, { filename })
  assert.deepEqual(parsed.errors, [])
  assert.ok(parsed.descriptor.template)
  const script = compileScript(parsed.descriptor, { id: filename })
  const template = compileTemplate({
    filename,
    id: filename,
    source: parsed.descriptor.template.content,
    compilerOptions: { bindingMetadata: script.bindings }
  })
  assert.deepEqual(template.errors, [])
  return source
}

test('global work item board compiles and pages each column with full totals', () => {
  const source = compilePage('../app/pages/work-items.vue')
  assert.match(source, /columnTotals\[col\.key\]/)
  assert.match(source, /<UPagination/)
  assert.match(source, /pageSize: '20'/)
  assert.match(source, /summary\.value\.status/)
})

test('project work item list compiles and sends complete filters before pagination', () => {
  const source = compilePage('../app/pages/projects/[id]/work-items.vue')
  assert.match(source, /page: listPage\.value/)
  assert.match(source, /milestoneId: activeMilestoneId\.value/)
  assert.match(source, /<UPagination/)
  assert.match(source, /workItemStore\.total/)
})

test('project board pages each status and keeps ancestor context', () => {
  for (const path of ['../app/pages/projects/[id]/work-items.vue', '../app/pages/projects/[id]/board.vue']) {
    const source = compilePage(path)
    assert.match(source, /fetchBoardPages/)
    assert.match(source, /boardColumnTotal/)
    assert.match(source, /boardAncestorPath/)
    assert.match(source, /<UPagination/)
  }
})
