import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

function compile(path: string) {
  const filename = new URL(path, import.meta.url).pathname
  const { descriptor, errors } = parse(readFileSync(filename, 'utf8'), { filename })
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: filename })
  const template = compileTemplate({ filename, id: filename, source: descriptor.template!.content, compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  return descriptor
}

test('shared project editor compiles as a complete SFC', () => {
  compile('../app/components/DirectoryProjectEditor.vue')
})

test('project editor preserves the original write contract and keeps Console drawers as default', () => {
  const editor = compile('../app/components/DirectoryProjectEditor.vue')
  const script = editor.scriptSetup!.content
  const template = editor.template!.content
  assert.match(script, /if \(props\.page\) \{/)
  assert.match(script, /props\.initialMode === 'members'.*loadMembers\(props\.initialProject\)/)
  assert.match(script, /props\.initialMode === 'edit'.*openEditProject\(props\.initialProject\)/)
  assert.match(script, /if \(!Number\.isSafeInteger\(response\.data\.total\).*response\.data\.total > 100/)
  assert.match(script, /mutation\.submit\(request/)
  assert.match(script, /mutation\.pending.*lastSuccess/)
  assert.match(script, /projectSurface\.value\?\.markSaved\(\)/)
  assert.match(script, /membersSurface\.value\?\.markSaved\(\)/)
  assert.match(template, /:page="props\.page"/)
  assert.match(template, /:draft="JSON\.stringify\(projectForm\)"/)
  assert.match(template, /:draft="editableMembersText"/)
})
