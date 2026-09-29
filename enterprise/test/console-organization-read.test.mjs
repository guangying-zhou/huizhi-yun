import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { createServer } from 'node:http'
import { createApp, createRouter, toNodeListener } from 'h3'
import { readFileSync } from 'node:fs'
import { isBusinessApiReady } from '../composition/business-api-readiness.mjs'
import { resolveEnterprisePilotPath } from '../../deploy/test-env/enterprise-topology.mjs'
import { matchConsoleUserApiRoute, resolveConsoleUserApiRoute } from '../../foundation/shared/utils/consoleUserApiRoutes.ts'

const paths = ['/enterprise/api/organization/business-domains', '/enterprise/api/organization/regions', '/enterprise/api/organization/regions/R1/divisions']
test('C1 exact GET paths agree across registry, BFF readiness and Gateway', () => {
  for (const path of paths) {
    assert.equal(resolveEnterprisePilotPath(path).kind, 'api')
    assert.equal(isBusinessApiReady('GET', path), true)
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(isBusinessApiReady(method, path), false)
  }
  for (const id of ['organization.business-domains.list', 'organization.regions.list', 'organization.regions.divisions.list']) {
    const params = { companyCode: 'C1', ...(id.includes('divisions') ? { regionCode: 'R1' } : {}) }
    const { route, path } = resolveConsoleUserApiRoute(id, params)
    assert.equal(route.write, false)
    assert.deepEqual(route.query, [])
    assert.equal(matchConsoleUserApiRoute('GET', path).id, id)
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) assert.equal(matchConsoleUserApiRoute(method, path), null)
  }
  for (const path of ['/enterprise/api/organization/companies/C2/regions', '/enterprise/api/organization/regions/R1/action', '/enterprise/api/organization/regions/../divisions', '/enterprise/api/organization/regions/' + 'A'.repeat(129) + '/divisions']) assert.equal(resolveEnterprisePilotPath(path).kind, 'unavailable')
  for (const name of ['business-domains', 'regions']) {
    assert.equal(resolveEnterprisePilotPath('/enterprise/admin/' + name).kind, 'page')
    const page = readFileSync(new URL('../app/pages/enterprise/admin/' + name + '.vue', import.meta.url), 'utf8')
    assert.match(page, /navigationOwner: 'console'/)
  }
  const component = readFileSync(new URL('../../foundation/app/components/OrganizationConfigurationReadPage.vue', import.meta.url), 'utf8')
  assert.match(component, /\/console\/admin\//)
  assert.match(component, /<CommonEmptyState/)
  assert.match(component, /:loading="pending"/)
  assert.doesNotMatch(component, /method: '(POST|PATCH|PUT|DELETE)'/)
})

test('C1 current company is server resolved; output is rebuilt and arbitrary queries fail closed', async () => {
  const state = { seen: [], status: 0, foreign: false, absent: false }
  globalThis.__organizationReadTest = state
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@hzy/foundation/server/utils/consoleUserApi') return { shortCircuit: true, url: `data:text/javascript,${encodeURIComponent(`export async function fetchConsoleUserApi(event,id,options){
      const s=globalThis.__organizationReadTest;s.seen.push({id,options});
      if(s.status)throw Object.assign(Error('LEAK token=secret upstream'),{statusCode:s.status});
      if(id==='org-profile.read')return {tenantCode:'C1',orgName:'Current company',password:'SENTINEL'};
      const companyCode=s.foreign?'FOREIGN':'C1';
      if(id==='organization.business-domains.list')return [{companyCode,domainCode:'D1',domainName:'Domain',displayName:'Alias',aliasName:null,category:'2B',source:'custom',sortOrder:1,secret:'SENTINEL'}];
      if(id==='organization.regions.list')return s.absent?[]:[{companyCode,regionCode:'R1',regionName:'Region',description:null,sortOrder:1,divisionCount:1,secret:'SENTINEL'}];
      return [{divisionCode:'110000',divisionName:'Beijing',includeChildren:true,secret:'SENTINEL'}];
    }`)}` }
    if (specifier.endsWith('/utils/consoleOrganizationRead')) return { shortCircuit: true, url: new URL(specifier + '.ts', context.parentURL).href }
    return next(specifier, context)
  } })
  let server
  try {
    const router = createRouter()
    router.get(paths[0], (await import('../server/routes/enterprise/api/organization/business-domains/index.get.ts')).default)
    router.get(paths[1], (await import('../server/routes/enterprise/api/organization/regions/index.get.ts')).default)
    router.get('/enterprise/api/organization/regions/:regionCode/divisions', (await import('../server/routes/enterprise/api/organization/regions/[regionCode]/divisions.get.ts')).default)
    server = createServer(toNodeListener(createApp().use(router)))
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const request = path => fetch(`http://127.0.0.1:${server.address().port}${path}`)
    for (const path of paths) {
      state.seen.length=0
      const response=await request(path)
      assert.equal(response.status,200)
      assert.equal(response.headers.get('cache-control'),'private, no-store')
      const body=await response.text()
      assert.ok(!body.includes('SENTINEL'))
      assert.equal(state.seen[0].id,'org-profile.read')
      for(const call of state.seen.slice(1))assert.equal(call.options.params.companyCode,'C1')
      for(const query of ['?companyCode=FOREIGN','?uid=other','?page=1','?tenant=other','?companyCode=C1&companyCode=C2']) {
        const count=state.seen.length
        assert.equal((await request(path+query)).status,400)
        assert.equal(state.seen.length,count)
      }
      for(const status of [401,403,404,503,500]) {
        state.status=status
        const failure=await request(path)
        assert.equal(failure.status,status===500?502:status)
        assert.ok(!(await failure.text()).includes('LEAK'))
      }
      state.status=0
      state.foreign=true
      assert.equal((await request(path)).status,502)
      state.foreign=false
    }
    state.absent=true
    state.seen.length=0
    assert.equal((await request(paths[2])).status,404)
    assert.ok(!state.seen.some(call=>call.id.includes('divisions')))
    state.absent=false
    assert.equal((await request('/enterprise/api/organization/regions/'+'A'.repeat(129)+'/divisions')).status,400)
  } finally {
    if(server)await new Promise(resolve=>server.close(resolve))
    hooks.deregister()
    delete globalThis.__organizationReadTest
  }
})
