import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { businessModules, registerBusinessPages } from '../composition/registry.mjs'
import { projectHostNativePages, annotateHostNativePageAuthorization } from '../composition/host-native-pages.mjs'
import altoc from '../../altoc/layer/navigation.mjs'
import { parse, compileScript } from '@vue/compiler-sfc'

test('migration queue entries have exact Host routes, app snapshot ownership and manifest action gates', () => {
  const finance = registerBusinessPages([], businessModules, 'entry.vue').find(page => page.path === '/finance/migration')
  assert.equal(finance.meta.authorizationApp, 'finance')
  const native = projectHostNativePages(altoc).find(page => page.path === '/altoc/migration')
  assert.ok(native)
  const pages = [{ path: native.path, file: native.file }]
  annotateHostNativePageAuthorization(pages, [native])
  assert.equal(pages[0].meta.authorizationApp, 'altoc')
  assert.deepEqual(altoc.hostNavigation.entries.find(entry => entry.to === native.path).access, { kind: 'permission', resource: 'migration_exceptions', action: 'view' })
  const contribution = businessModules.find(module => module.code === 'finance').navigation.find(entry => entry.to === '/finance/migration')
  assert.deepEqual(contribution.permission, { resource: 'migration_exceptions', action: 'view' })
  const routes = readFileSync(new URL('../../deploy/test-env/enterprise-host-routes.mjs', import.meta.url), 'utf8')
  assert.match(routes, /\/altoc\/migration/)
  assert.match(routes, /\/finance\/migration/)
})
test('migration queue page wrappers compile and use the shared reviewed component', () => {
  for (const file of ['../app/pages/altoc/migration.vue', '../../finance/layer/pages/migration.vue']) {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    const { descriptor, errors } = parse(source, { filename: file })
    assert.deepEqual(errors, [])
    assert.doesNotThrow(() => compileScript(descriptor, { id: file, inlineTemplate: true }))
    assert.match(source, /import W3MigrationQueuePage from/)
    assert.match(source, /hostContentInset: false/)
  }
})
