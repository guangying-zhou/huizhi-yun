import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

for (const relativePath of [
  '../app/components/project/PeriodClosePanel.vue',
  '../app/pages/projects/[id]/milestones/[milestoneId].vue'
]) {
  const filename = new URL(relativePath, import.meta.url).pathname
  const source = readFileSync(filename, 'utf8')
  test(`${relativePath} compiles as a complete SFC and warns about legacy periodic milestones`, () => {
    const { descriptor, errors } = parse(source, { filename })
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: 'milestone-template-close-guard' })
    const template = compileTemplate({ filename, id: 'milestone-template-close-guard', source: descriptor.template!.content, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(template.errors, [])
    assert.match(source, /无法关期，请迁至模板/)
    assert.match(source, /templateKey/)
  })
}

test('period close excludes legacy periodic milestones from options', () => {
  const source = readFileSync(new URL('../app/components/project/PeriodClosePanel.vue', import.meta.url), 'utf8')
  assert.match(source, /periodicMilestones = computed\(\(\) => props\.milestones\.filter\(item => item\.mode === 'periodic' && Boolean\(item\.templateKey\)/)
})
