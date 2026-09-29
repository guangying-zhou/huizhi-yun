import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'

// These two components are shared between the standalone Aims app and the
// Enterprise Host (see aims/CLAUDE.md and aims/layer/entry.mjs). The Host
// does not register /projects/:id/settings or /projects/:id/environments,
// so any hard-coded link to those paths is a dead link once hosted.
const readVue = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const entrySource = readFileSync(new URL('../../aims/layer/entry.mjs', import.meta.url), 'utf8')

function assertValidSfc(source, path, id) {
  const { descriptor, errors } = parse(source, { filename: path })
  assert.deepEqual(errors, [])
  compileScript(descriptor, { id })
  assert.deepEqual(compileTemplate({ source: descriptor.template.content, filename: path, id }).errors, [])
}

test('Host does not register a project settings or environments page', () => {
  // Locks the premise these fixes depend on: if either path is ever
  // registered, this test should be revisited alongside the components below.
  assert.doesNotMatch(entrySource, /'\/projects\/:id\/settings'/)
  assert.doesNotMatch(entrySource, /'\/projects\/:id\/environments'/)
  assert.match(entrySource, /'\/projects\/:id\/edit'/)
})

test('ProjectModuleDisabledState links to the Host project edit page when hosted', () => {
  const path = '../../aims/app/components/project/ProjectModuleDisabledState.vue'
  const source = readVue(path)
  assertValidSfc(source, path, 'host-project-module-disabled-state')

  assert.match(source, /useAimsModule/)
  assert.match(source, /hosted\s*\?\s*moduleUrl\(`\/projects\/\$\{projectId\.value\}\/edit`\)/)
  assert.match(source, /:\s*moduleUrl\(`\/projects\/\$\{projectId\.value\}\/settings`\)/)
  assert.doesNotMatch(source, /:to="`\/projects\/\$\{projectId\}\/settings`"/)
})

test('ProjectNavbar settings tab redirects to Host edit page and hides the environments tab when hosted', () => {
  const path = '../../aims/app/components/project/ProjectNavbar.vue'
  const source = readVue(path)
  assertValidSfc(source, path, 'host-project-navbar')

  // 设置: hosted -> Host edit page, standalone -> unchanged settings page.
  assert.match(source, /hosted\s*\?\s*moduleUrl\(`\/projects\/\$\{pid\}\/edit`\)\s*:\s*moduleUrl\(`\/projects\/\$\{pid\}\/settings`\)/)
  // Only one settings tab definition remains; both category branches reuse it.
  assert.equal((source.match(/label: '设置'/g) || []).length, 1)

  // 环境: only pushed when not hosted, since the Host never registers the page.
  assert.match(source, /if \(!hosted && projectModuleEnabled\(moduleConfig, category, 'environments'\)\)/)
  assert.doesNotMatch(entrySource, /'\/projects\/:id\/service-desk'/)
  assert.match(source, /if \(!hosted && projectModuleEnabled\(moduleConfig, category, 'service_desk'\)\)/)
})
