import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { businessModules, registerBusinessPages } from '../composition/registry.mjs'

test('Codocs document route mounts the original full page inside the Enterprise layout', () => {
  const routes = registerBusinessPages([], businessModules, fileURLToPath(new URL('../app/module-entry.vue', import.meta.url)))
  const documentRoute = routes.find(route => route.path === '/codocs/documents/:uuid')
  assert.ok(documentRoute)
  assert.equal(documentRoute.name, 'codocs-document-editor')
  assert.equal(documentRoute.file, fileURLToPath(new URL('../../codocs/app/pages/documents/[uuid].vue', import.meta.url)))
  assert.equal(documentRoute.meta.layout, 'enterprise')
  const source = readFileSync(documentRoute.file, 'utf8')
  assert.match(source, /if \(hosted\) shareMembersLoaded\.value = false/)
  assert.match(source, /shareMembersLoaded\.value = true/)
  assert.match(source, /v-if="shouldLoadFromCollaboration && !isRealtimeCollaboration/)
  assert.match(source, /versionsError\.value = status === 403/)
  const sidebar = readFileSync(fileURLToPath(new URL('../../codocs/app/components/editor/EditorSidebar.vue', import.meta.url)), 'utf8')
  assert.match(sidebar, /v-else-if="versionsError"/)
  assert.match(sidebar, /@click="emit\('load-versions'\)"/)
  const layout = readFileSync(fileURLToPath(new URL('../app/layouts/default.vue', import.meta.url)), 'utf8')
  assert.match(layout, /<nav\s+class="relative hidden shrink-0/)
  assert.doesNotMatch(layout, /<nav\s+v-if="!editorWorkspace"/)
})
