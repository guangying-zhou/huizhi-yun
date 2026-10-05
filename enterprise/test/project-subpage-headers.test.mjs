import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'
import vm from 'node:vm'
import ts from 'typescript'
import { computed, ref, reactive } from 'vue'
import { baseParse } from '@vue/compiler-dom'
import { projectNameError } from '../../aims/shared/projectName.ts'

const parents = { 'requirement-detail': 'requirements', 'output-detail': 'output', 'release-detail': 'releases', 'document-detail': 'documents', 'document-open': 'documents/${documentId}', 'time-entry-detail': 'timesheet', 'weekly-report-detail': 'weekly-reports', 'edit': '${id}' }
const read = name => readFileSync(new URL(`../../aims/layer/pages/enterprise-project-${name}.vue`, import.meta.url), 'utf8')
function elements(node, tag) {
  return [...(node.type === 1 && node.tag === tag ? [node] : []), ...(node.children || []).flatMap(child => elements(child, tag))]
}
function slot(node, name) {
  return (node.children || []).find(child => child.type === 1 && child.tag === 'template' && child.props.some(prop => prop.type === 7 && prop.name === 'slot' && prop.arg?.content === name))
}
for (const [name, parent] of Object.entries(parents)) {
  test(`project ${name} uses the shared panel header and a fixed parent return`, () => {
    const source = read(name), { descriptor, errors } = parse(source)
    assert.deepEqual(errors, [])
    const root = baseParse(descriptor.template.content), panels = elements(root, 'UDashboardPanel')
    assert.equal(panels.length, 1)
    const body = slot(panels[0], 'body')
    assert.equal(elements(body, 'ProjectNavbar').length, 1)
    assert.equal(elements(root, 'h1').length, 0)
    assert.ok(elements(body, 'h2').some(node => node.loc.source.includes('text-xl font-semibold')))
    const returnButton = elements(body, 'UButton').find(node => node.loc.source.includes('i-lucide-arrow-left'))
    assert.ok(returnButton)
    assert.ok(returnButton.loc.source.includes(parent))
    assert.match(returnButton.loc.source, /variant="link" color="neutral"|variant="link"\s+color="neutral"/)
    assert.doesNotMatch(source, /router.back\(|history.back\(/)
  })
}
test('detail actions retain their readiness gates within Navbar actions', () => {
  for (const name of ['document-detail', 'time-entry-detail', 'weekly-report-detail', 'edit']) {
    const root = baseParse(parse(read(name)).descriptor.template.content)
    const actions = slot(elements(root, 'ProjectNavbar')[0], 'actions')
    assert.ok(actions)
    if (name === 'document-detail') assert.match(actions.loc.source, /documentSource.*codocs.*codocsUuid/)
    // The name rule is reported on submit, never as a silently disabled button.
    if (name === 'edit') assert.doesNotMatch(actions.loc.source, /:disabled=.*nameError/)
    if (name.includes('entry') || name.includes('weekly')) assert.match(actions.loc.source, /aria-label="刷新"/)
  }
})

test('project name validation stays neutral until blur or submit, with false for a valid value', () => {
  const source = read('edit')
  const declarations = ['nameChanged', 'nameError', 'nameValidationVisible', 'nameFieldError'].map(name => source.match(new RegExp(`^const ${name} = .*`, 'm'))[0]).join('\n')
  const form = reactive({ name: '有效项目' }), context = { form, ref, computed, projectName: ref('有效项目'), projectNameError }
  vm.createContext(context)
  vm.runInContext(ts.transpile(declarations + '\nthis.validation = { nameValidationVisible, nameFieldError }', { target: ts.ScriptTarget.ES2022 }), context)
  assert.equal(context.validation.nameFieldError.value, false)
  form.name = 'invalid name'
  assert.equal(context.validation.nameFieldError.value, false)
  context.validation.nameValidationVisible.value = true
  assert.match(context.validation.nameFieldError.value, /不允许空格/)
  form.name = '有效项目'
  assert.equal(context.validation.nameFieldError.value, false)
  // A stored legacy name (created before the Host enforced the rule) stays
  // editable while untouched: it is neither flagged nor sent.
  context.projectName.value = 'ZZ-TPLFIX-20260928 模板修复验证'
  form.name = 'ZZ-TPLFIX-20260928 模板修复验证'
  assert.equal(context.validation.nameFieldError.value, false)
  form.name = 'ZZ-TPLFIX-20260928 改名'
  assert.match(context.validation.nameFieldError.value, /不允许空格/)
  assert.match(source, /return nameChanged\.value \? \{ \.\.\.rest, name \} : rest/)
  assert.match(source, /body: updateBody\(\)/)
  assert.match(source, /@blur="nameValidationVisible=true"/)
  assert.match(source, /async function save\(\) \{\s*nameValidationVisible.value = true/)
})
