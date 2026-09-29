import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { effectiveProjectSecurityLevel, projectAccessControlPatch } from '../app/utils/projectAccessControl'

const filename = new URL('../layer/pages/enterprise-project-edit.vue', import.meta.url).pathname
const source = readFileSync(filename, 'utf8')

test('Host project edit compiles with a body-mounted access control panel', () => {
  const { descriptor, errors } = parse(source, { filename })
  assert.deepEqual(errors, [])
  const script = compileScript(descriptor, { id: 'enterprise-project-access-control' })
  const template = compileTemplate({ filename, id: 'enterprise-project-access-control', source: descriptor.template!.content, compilerOptions: { bindingMetadata: script.bindings } })
  assert.deepEqual(template.errors, [])
  assert.match(descriptor.template!.content, /<template #body>[\s\S]*?访问控制/)
  assert.match(source, /const \{ confirm \} = useConfirm\(\)/)
  assert.match(source, /<ProjectAccessControlFields/)
  assert.match(source, /tone: 'warning'/)
  assert.match(source, /effectiveSecurityLevel\.value !== effectiveProjectSecurityLevel\(originalAccess\.value\.securityLevel, originalAccess\.value\.confidentialityLevel\)/)
  assert.match(source, /projectLeaderUid\.value === currentUid\.value \|\| projectCurrentRole\.value === 'manager'/)
  assert.match(source, /if \(!canEditAccess\.value/)
  assert.match(source, /accessFeedback\.value = 'conflict'/)
  assert.match(source, /await refreshComparison|@click="refreshComparison"/)
})

test('Host and independent project forms reuse one access control component', () => {
  for (const relativePath of [
    '../app/components/project/ProjectAccessControlFields.vue',
    '../app/components/project/ProjectEditModal.vue',
    '../app/pages/admin/projects.vue',
    '../app/pages/projects/[id]/settings.vue'
  ]) {
    const path = new URL(relativePath, import.meta.url).pathname
    const source = readFileSync(path, 'utf8')
    const { descriptor, errors } = parse(source, { filename: path })
    assert.deepEqual(errors, [], relativePath)
    const script = compileScript(descriptor, { id: 'shared-project-access-control' })
    const template = compileTemplate({ filename: path, id: 'shared-project-access-control', source: descriptor.template!.content, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(template.errors, [], relativePath)
    if (relativePath !== '../app/components/project/ProjectAccessControlFields.vue') assert.match(source, /<ProjectAccessControlFields/)
  }
})

test('access patch preserves absent whitelist and includes only edited fields', () => {
  const original = { securityLevel: 'company' as const, confidentialityLevel: 'L1' as const, accessWhitelist: null }
  assert.deepEqual(projectAccessControlPatch(original, { securityLevel: 'department', confidentialityLevel: 'L1', accessWhitelist: null }), { securityLevel: 'department' })
  assert.deepEqual(projectAccessControlPatch(original, { securityLevel: 'company', confidentialityLevel: 'L2', accessWhitelist: null }), { confidentialityLevel: 'L2' })
  assert.deepEqual(projectAccessControlPatch(original, { securityLevel: 'company', confidentialityLevel: 'L1', accessWhitelist: [] }), { accessWhitelist: [] })
  assert.deepEqual(projectAccessControlPatch(original, original), {})
})

test('preview uses the same L2/L3 minimum visibility rules as the server', () => {
  assert.equal(effectiveProjectSecurityLevel('company', 'L2'), 'department')
  assert.equal(effectiveProjectSecurityLevel('company', 'L3'), 'project_team')
  assert.equal(effectiveProjectSecurityLevel('department', 'L3'), 'project_team')
  assert.equal(effectiveProjectSecurityLevel('whitelist', 'L3'), 'whitelist')
})
