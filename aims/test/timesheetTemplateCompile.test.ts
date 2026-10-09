import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileTemplate } from 'vue/compiler-sfc'

test('timesheet template compiles all event expressions before Host registration', () => {
  const filename = new URL('../app/pages/timesheet.vue', import.meta.url)
  const { descriptor, errors } = parse(readFileSync(filename, 'utf8'))
  assert.deepEqual(errors, [])
  assert.ok(descriptor.template)
  const compiled = compileTemplate({
    filename: filename.pathname,
    source: descriptor.template.content,
    id: 'timesheet-template-regression'
  })
  assert.deepEqual(compiled.errors, [])
})

test('project time writes retain a key for every row until the whole user intent succeeds', () => {
  const source = readFileSync(new URL('../app/pages/timesheet.vue', import.meta.url), 'utf8')
  assert.match(source, /timeEntryIntents\.headers\(intent, body\)/)
  assert.match(source, /await Promise\.all\(rows\.map\(row => postProjectTimeEntry\(row\)\)\)[\s\S]*timeEntryIntents\.complete\(`report-create:/)
  assert.match(source, /await Promise\.all\(rows\.map\(saveDetailTimeEntry\)\)[\s\S]*timeEntryIntents\.complete\(detailTimeEntryIntent\(row\)\)/)
  assert.match(source, /retry: 0/)
})
