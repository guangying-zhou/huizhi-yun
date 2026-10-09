import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import altoc from '../../altoc/layer/navigation.mjs'
import { businessModules, navigationContributors, hostNativePages, navigationSources, buildBusinessNavigation } from '../composition/registry.mjs'
import { businessAreas, auxiliaryAreas } from '../composition/business-areas.mjs'
import { navigationLeaves, resolveNavigationAccess } from '../shared/navigation-access.mjs'
import { authorizationResourcesAllow } from '../../foundation/shared/utils/authorizationActions.ts'
import { matchRegisteredPage } from '../shared/registered-page.mjs'
import { selectActiveLeaf } from '../app/utils/navigation-active.mjs'

test('Altoc manifest contributes twenty-five native pages and eleven exact personnel view leaves without installing its layer', async () => {
  assert.ok(!businessModules.some(module => module.code === 'altoc'))
  const manifest = JSON.parse(readFileSync(new URL('../../altoc/app.manifest.json', import.meta.url), 'utf8'))
  const installed = JSON.parse(readFileSync(new URL('../app.manifest.json', import.meta.url), 'utf8')).composition.modules
  assert.ok(!installed.some(module => module.appCode === 'altoc'))
  assert.equal(navigationSources.find(source => source.appCode === 'altoc').manifestHash, createHash('sha256').update(JSON.stringify(manifest)).digest('hex'))
  const pages = hostNativePages.filter(page => page.module === 'altoc')
  assert.equal(pages.length, 25)
  for (const page of pages) {
    assert.ok(matchRegisteredPage(page.path.replace(/:[^/]+$/, '7'), hostNativePages))
    assert.match(readFileSync(page.file, 'utf8'), /navigationOwner: 'altoc'/)
  }
  const nav = buildBusinessNavigation(navigationContributors, businessAreas, auxiliaryAreas)
  const leaves = navigationLeaves(nav, []).filter(leaf => leaf.module === 'altoc')
  assert.deepEqual(leaves.map(leaf => leaf.permission), ['customer', 'migration_exceptions', 'lead', 'opportunity', 'opportunity', 'quotation', 'contract', 'receivable', 'contract', 'service_ticket', 'renewal_opportunity'].map(resource => ({ resource, action: 'view' })))
  assert.deepEqual(nav.primary.find(area => area.code === 'sales').children.map(group => group.code), ['customer', 'opportunity', 'quote', 'contract', 'settlement'])
  for (const [folder, id] of [['customers', 'altoc.sales.customers'], ['contracts', 'altoc.sales.contracts'], ['payments', 'altoc.sales.payments'], ['leads', 'altoc.sales.leads'], ['opportunities', 'altoc.sales.opportunities'], ['quotes', 'altoc.sales.quotes'], ['tenders', 'altoc.sales.tenders']]) assert.equal(selectActiveLeaf(nav.primary, `/altoc/${folder}/7`), id)
  const allows = (snapshot, permission) => authorizationResourcesAllow(snapshot.resources, permission.resource, permission.action)
  const calls = []
  const visible = await resolveNavigationAccess(leaves, { available: true, load: async (app) => {
    calls.push(app)
    return { resources: { customer: ['view'], contract: [], receivable: ['view'], lead: ['view'], opportunity: [], quotation: ['view'] } }
  }, allows })
  assert.ok(visible.includes('altoc.sales.customers'))
  assert.ok(!visible.includes('altoc.sales.contracts'))
  assert.ok(!visible.includes('altoc.sales.migration'))
  assert.ok(visible.includes('altoc.sales.payments'))
  assert.ok(visible.includes('altoc.sales.leads'))
  assert.ok(!visible.includes('altoc.sales.opportunities'))
  assert.ok(visible.includes('altoc.sales.quotes'))
  assert.deepEqual(calls, ['altoc'])
  assert.equal(selectActiveLeaf(nav.primary, '/altoc/service-agreements/7'), 'altoc.service.agreements')
  const invalid = structuredClone(altoc)
  invalid.hostNavigation.entries[0].access = { kind: 'permission', resource: 'customer', action: 'deploy' }
  assert.throws(() => buildBusinessNavigation([invalid], businessAreas, auxiliaryAreas), /manifest/)
  invalid.hostNavigation.entries[0].access = { kind: 'authenticated-self' }
  assert.throws(() => buildBusinessNavigation([invalid], businessAreas, auxiliaryAreas), /condition/)
})
