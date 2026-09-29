import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import consoleNavigation from '../../console/layer/navigation.mjs'
import { businessModules, navigationContributors, hostNativePages, navigationSources, buildBusinessNavigation } from '../composition/registry.mjs'
import { projectHostNativePages, validateHostNativePages } from '../composition/host-native-pages.mjs'
import { auxiliaryAreas, businessAreas } from '../composition/business-areas.mjs'
import { navigationLeaves, resolveNavigationAccess, filterNavigationAccess } from '../shared/navigation-access.mjs'
import { authorizationResourcesAllow } from '../../foundation/shared/utils/authorizationActions.ts'
import { matchRegisteredPage } from '../shared/registered-page.mjs'
import { selectActiveLeaf } from '../app/utils/navigation-active.mjs'

const nav = buildBusinessNavigation(navigationContributors, businessAreas, auxiliaryAreas)
const leaves = navigationLeaves(nav, []).filter(item => item.module === 'console')
const mutate = (change) => {
  const module = structuredClone(consoleNavigation)
  change(module.hostNavigation)
  return module
}

test('Console contributes manifest-owned navigation without becoming an installation module', () => {
  assert.deepEqual(businessModules.map(module => module.code), ['aims', 'assets', 'codocs'])
  const manifest = JSON.parse(readFileSync(new URL('../app.manifest.json', import.meta.url), 'utf8'))
  assert.deepEqual(manifest.composition.modules.map(module => module.appCode).sort(), ['aims', 'assets', 'codocs'])
  assert.equal(leaves.length, 13)
  assert.deepEqual(nav.primary.find(area => area.code === 'workspace').children.find(group => group.code === 'self').children.filter(item => item.module === 'console').map(item => item.to), ['/enterprise/notifications', '/enterprise/todos'])
  const management = nav.auxiliary.find(area => area.code === 'console')
  assert.deepEqual(management.children.filter(group => group.children.some(item => item.module === 'console')).map(group => group.code), ['enterprise', 'config', 'integration'])
  assert.equal(management.children[0].children.length, 5)
  assert.ok(!leaves.some(item => item.to === '/enterprise/profile'))
  const source = JSON.parse(readFileSync(new URL('../../console/app.manifest.json', import.meta.url), 'utf8'))
  assert.equal(navigationSources.find(item => item.appCode === 'console').manifestHash, createHash('sha256').update(JSON.stringify(source)).digest('hex'))
  const layout = readFileSync(new URL('../app/layouts/default.vue', import.meta.url), 'utf8')
  assert.match(layout, /<UDropdownMenu\s+v-if="signedIn"/)
  assert.match(layout, /label: '个人资料'.*to: '\/enterprise\/profile'/)
})

test('Host native ownership, real files, Nuxt registration and deep links agree', () => {
  assert.equal(hostNativePages.filter(page => page.module === 'console').length, 20)
  validateHostNativePages(hostNativePages, hostNativePages)
  const detail = hostNativePages.find(page => page.path.includes(':notificationId'))
  const nuxtDynamic = hostNativePages.map(page => page === detail ? { ...page, path: page.path.replace(':notificationId', ':notificationId()') } : page)
  validateHostNativePages(nuxtDynamic, hostNativePages)
  assert.throws(() => validateHostNativePages(hostNativePages.slice(1), hostNativePages), /differs from Nuxt/)
  assert.throws(() => validateHostNativePages([...hostNativePages, hostNativePages[0]], hostNativePages), /differs from Nuxt/)
  assert.ok(matchRegisteredPage('/enterprise/notifications/N1', hostNativePages))
  assert.equal(selectActiveLeaf([...nav.primary, ...nav.auxiliary], '/enterprise/notifications/N1'), 'console.workspace.notifications')
  assert.throws(() => projectHostNativePages({ ...consoleNavigation, code: 'assets' }), /owner mismatch/)
  for (const path of ['/enterprise/profile', '/enterprise/missing', '/enterprise/../login', 'https://example.test', '/enterprise/todos?uid=other']) {
    assert.throws(() => projectHostNativePages(mutate(declaration => declaration.pages.push(path))), /owner mismatch|missing|Invalid/)
  }
  assert.throws(() => projectHostNativePages(mutate(declaration => declaration.pages.push(declaration.pages[0]))), /duplicate/)
  assert.throws(() => buildBusinessNavigation([consoleNavigation], businessAreas, auxiliaryAreas, []), /not registered/)
})

test('Console declarations reject invalid or mixed access, permissions, aliases and off-owner targets', () => {
  for (const access of [{}, { kind: 'public' }, { kind: 'authenticated-self', uid: 'other' }, { kind: 'permission', resource: 'missing', action: 'view' }, { kind: 'permission', resource: 'directory_users', action: 'deploy' }, null]) {
    assert.throws(() => buildBusinessNavigation([mutate((declaration) => {
      declaration.entries[0].access = access
    })], businessAreas, auxiliaryAreas), /condition|manifest/)
  }
  assert.throws(() => buildBusinessNavigation([mutate((declaration) => {
    declaration.entries[0].permission = { resource: 'org_profile', action: 'view' }
  })], businessAreas, auxiliaryAreas), /mixed/)
  for (const to of ['/enterprise/profile', '/enterprise/notifications/N1', '/aims/projects', '/enterprise/directory/users?uid=other']) {
    assert.throws(() => buildBusinessNavigation([mutate((declaration) => {
      declaration.entries[0].to = to
    })], businessAreas, auxiliaryAreas), /target/)
  }
  assert.throws(() => buildBusinessNavigation([mutate((declaration) => {
    declaration.entries.push({ ...declaration.entries[0] })
  })], businessAreas, auxiliaryAreas), /Duplicate/)
  assert.throws(() => buildBusinessNavigation([mutate((declaration) => {
    declaration.entries.push({ ...declaration.entries[0], id: 'weaker.alias', access: { kind: 'authenticated-self' } })
  })], businessAreas, auxiliaryAreas), /share destination permissions/)
})

test('authenticated-self is explicit and never bypasses management snapshots or availability', async () => {
  for (const [resources, managementIds] of [
    [{}, []],
    [{ directory_users: ['view'] }, ['users']],
    [{ directory_users: ['edit'] }, ['users']],
    [{ directory_departments: ['admin'] }, ['departments', 'committees']],
    [{ org_profile: ['view'], directory_projects: ['view'] }, ['org-profile', 'projects', 'config.business-domains', 'config.regions']]
  ]) {
    const loads = []
    const options = { available: true, authenticatedSelf: true, load: async (module) => {
      loads.push(module)
      return { resources }
    }, allows: (snapshot, permission) => authorizationResourcesAllow(snapshot.resources, permission.resource, permission.action) }
    const ids = await resolveNavigationAccess(leaves, options)
    assert.deepEqual([...ids].sort(), [...managementIds.map(id => id.startsWith('config.') ? `console.${id}` : `console.enterprise.${id}`), 'console.workspace.notifications', 'console.workspace.todos'].sort())
    assert.deepEqual(loads, ['console'])
    const filtered = filterNavigationAccess(nav, ids)
    assert.equal(filtered.auxiliary.some(area => area.code === 'console'), managementIds.length > 0)
    assert.deepEqual(await resolveNavigationAccess(leaves, { ...options, available: false }), [])
    const withoutSession = await resolveNavigationAccess(leaves, { ...options, authenticatedSelf: false })
    assert.ok(!withoutSession.some(id => id.startsWith('console.workspace.')))
  }
  const self = leaves.filter(item => item.access)
  assert.deepEqual(await resolveNavigationAccess(self, { available: true, authenticatedSelf: true, load: () => {
    throw Error('self must not load management permissions')
  } }), self.map(item => item.id))
  assert.deepEqual(await resolveNavigationAccess(self, { available: true }), [])
  await assert.rejects(resolveNavigationAccess(leaves, { available: true, authenticatedSelf: true, load: async () => {
    throw Error('Console503')
  } }), /Console503/)
})

test('calendar navigation uses Console system_settings view in the existing config group', async () => {
  const calendar = leaves.find(item => item.id === 'console.config.work-calendar')
  assert.equal(calendar.to, '/enterprise/work-calendar')
  assert.deepEqual(calendar.permission, { resource: 'system_settings', action: 'view' })
  for (const [resources, visible] of [[{}, false], [{ directory_users: ['admin'] }, false], [{ system_settings: ['view'] }, true], [{ system_settings: ['edit'] }, true]]) {
    const ids = await resolveNavigationAccess([calendar], { available: true, load: async () => ({ resources }), allows: (snapshot, permission) => authorizationResourcesAllow(snapshot.resources, permission.resource, permission.action) })
    assert.equal(ids.includes(calendar.id), visible)
  }
})

test('sync contribution is permission gated and keeps detail deep links on its list', async () => {
  const sync = leaves.find(item => item.id === 'console.integration.directory-sync')
  assert.deepEqual(sync.permission, { resource: 'directory_sync', action: 'view' })
  assert.ok(matchRegisteredPage('/enterprise/directory/sync/J1', hostNativePages))
  assert.equal(selectActiveLeaf([...nav.primary, ...nav.auxiliary], '/enterprise/directory/sync/J1'), sync.id)
  for (const [resources, visible] of [[{}, false], [{ directory_users: ['admin'] }, false], [{ directory_sync: ['view'] }, true]]) {
    const ids = await resolveNavigationAccess([sync], { available: true, load: async () => ({ resources }), allows: (snapshot, permission) => authorizationResourcesAllow(snapshot.resources, permission.resource, permission.action) })
    assert.equal(ids.includes(sync.id), visible)
  }
})
