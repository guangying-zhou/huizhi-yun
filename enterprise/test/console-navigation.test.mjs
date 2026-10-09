import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import consoleNavigation from '../../console/layer/navigation.mjs'
import { businessModules, navigationContributors, hostNativePages, navigationSources, buildBusinessNavigation } from '../composition/registry.mjs'
import { projectHostNativePages, validateHostNativePages } from '../composition/host-native-pages.mjs'
import { auxiliaryAreas, businessAreas } from '../composition/business-areas.mjs'
import { navigationLeaves, resolveNavigationAccess } from '../shared/navigation-access.mjs'
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
  assert.deepEqual(businessModules.map(module => module.code), ['aims', 'assets', 'codocs', 'finance', 'people'])
  const manifest = JSON.parse(readFileSync(new URL('../app.manifest.json', import.meta.url), 'utf8'))
  assert.deepEqual(manifest.composition.modules.map(module => module.appCode).sort(), ['aims', 'assets', 'codocs'])
  // Console administration stays a standalone console (ADR-018a D8): the Host keeps only the personal pages.
  assert.equal(leaves.length, 2)
  assert.deepEqual(nav.primary.find(area => area.code === 'workspace').children.flatMap(group => group.children).filter(item => item.module === 'console').map(item => item.to), ['/enterprise', '/enterprise/todos'])
  // Business modules keep their own admin pages in that sidebar area; none of them is a Console page.
  assert.ok(!(nav.auxiliary.find(area => area.code === 'console')?.children || []).some(group => group.children.some(item => item.module === 'console')))
  assert.ok(!leaves.some(item => item.to === '/enterprise/profile' || item.permission))
  const source = JSON.parse(readFileSync(new URL('../../console/app.manifest.json', import.meta.url), 'utf8'))
  assert.equal(navigationSources.find(item => item.appCode === 'console').manifestHash, createHash('sha256').update(JSON.stringify(source)).digest('hex'))
  const layout = readFileSync(new URL('../app/layouts/default.vue', import.meta.url), 'utf8')
  assert.match(layout, /<UDropdownMenu\s+v-if="signedIn"/)
  assert.match(layout, /label: '个人资料'.*to: '\/enterprise\/profile'/)
})

test('Host native ownership, real files, Nuxt registration and deep links agree', () => {
  assert.deepEqual(hostNativePages.filter(page => page.module === 'console').map(page => page.path), ['/enterprise', '/enterprise/notifications', '/enterprise/notifications/:notificationId', '/enterprise/todos', '/enterprise/announcements', '/enterprise/announcements/manage', '/enterprise/announcements/:announcementId', '/enterprise/help', '/enterprise/feedback', '/enterprise/feedback/:feedbackId'])
  validateHostNativePages(hostNativePages, hostNativePages)
  const detail = hostNativePages.find(page => page.path.includes(':notificationId'))
  const nuxtDynamic = hostNativePages.map(page => page === detail ? { ...page, path: page.path.replace(':notificationId', ':notificationId()') } : page)
  validateHostNativePages(nuxtDynamic, hostNativePages)
  assert.throws(() => validateHostNativePages(hostNativePages.slice(1), hostNativePages), /differs from Nuxt/)
  assert.throws(() => validateHostNativePages([...hostNativePages, hostNativePages[0]], hostNativePages), /differs from Nuxt/)
  assert.ok(matchRegisteredPage('/enterprise/notifications/N1', hostNativePages))
  assert.equal(selectActiveLeaf([...nav.primary, ...nav.auxiliary], '/enterprise'), 'console.workspace.home')
  assert.ok(!leaves.some(item => item.to === '/enterprise/notifications'))
  assert.throws(() => projectHostNativePages({ ...consoleNavigation, code: 'assets' }), /owner mismatch|Invalid/)
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
    declaration.entries.push({ ...declaration.entries[0], id: 'different.alias', access: { kind: 'permission', resource: 'org_profile', action: 'view' } })
  })], businessAreas, auxiliaryAreas), /share destination permissions/)
})

test('authenticated-self entries need a verified session and never load a management snapshot', async () => {
  assert.ok(leaves.every(item => item.access?.kind === 'authenticated-self'))
  const options = { available: true, authenticatedSelf: true, load: () => {
    throw Error('self must not load management permissions')
  } }
  assert.deepEqual([...await resolveNavigationAccess(leaves, options)].sort(), ['console.workspace.home', 'console.workspace.todos'])
  assert.deepEqual(await resolveNavigationAccess(leaves, { ...options, available: false }), [])
  assert.deepEqual(await resolveNavigationAccess(leaves, { ...options, authenticatedSelf: false }), [])
  assert.deepEqual(await resolveNavigationAccess(leaves, { available: true }), [])
})

test('the Console entry is a fail-closed hint read from the server Console snapshot and opens a new tab', () => {
  const access = readFileSync(new URL('../app/composables/useConsoleEntryAccess.ts', import.meta.url), 'utf8')
  assert.match(access, /\$fetch\('\/enterprise\/api\/auth\/permissions', \{ query: \{ app: 'console' \}/)
  assert.match(access, /parseAuthorizationSnapshotResponse\(response, 'console'\)/)
  assert.match(access, /authorizationResourcesAllow\(snapshot\.resources, 'console_overview', 'view'/)
  assert.match(access, /allowed\.value = false\n\s+if \(!current\) return/)
  assert.match(access, /catch \{\n\s+\/\/ Fail closed/)
  const manifest = JSON.parse(readFileSync(new URL('../../console/app.manifest.json', import.meta.url), 'utf8'))
  assert.ok(manifest.resources.find(resource => resource.code === 'console_overview').actions.includes('view'))
  const layout = readFileSync(new URL('../app/layouts/default.vue', import.meta.url), 'utf8')
  assert.match(layout, /consoleEntry\.allowed\.value \? \[\{ label: '控制台', icon: 'i-lucide-settings', to: '\/console\/admin', target: '_blank', external: true \}\] : \[\]/)
  assert.match(layout, /:items="personalMenu"/)
})
