import test from 'node:test'
import assert from 'node:assert/strict'
import gateway from './cloudflare-gateway.mjs'
import {registryDigest} from './enterprise-registry-digest.mjs'
import {mergeEnterpriseSource} from './enterprise-registry-merge.mjs'
const registry={domains:{'hzy-test.huizhi.yun':{tenantCode:'C000001',environment:'test',apps:{console:{deploymentCode:'wiztek-test-console'},aims:{deploymentCode:'old'}},dataRuntime:{endpoint:'https://hzy-test-runtime.isme.dev'},login:{secret:'do-not-expose'}}}}
test('registry digest is canonical, authenticated and does not disclose configuration',async()=>{
 const env={HZY_TENANT_GATEWAY_INTERNAL_TOKEN:'fixture',HZY_TENANT_GATEWAY_REGISTRY_JSON:JSON.stringify(registry)}
 for(const [method,key]of [['GET','fixture'],['POST',''],['POST','wrong']]){const r=await gateway.fetch(new Request('https://hzy-test.huizhi.yun/__test/registry-digest',{method,headers:{authorization:`Bearer ${key}`}}),env);assert.equal(r.status,404)}
 const r=await gateway.fetch(new Request('https://hzy-test.huizhi.yun/__test/registry-digest',{method:'POST',headers:{authorization:'Bearer fixture'}}),env),body=await r.text();assert.equal(r.status,200);assert.ok(!body.includes('do-not-expose'));assert.equal(JSON.parse(body).sha256,await registryDigest(registry));assert.equal(await registryDigest({a:1,b:2}),await registryDigest({b:2,a:1}))
 const merged=mergeEnterpriseSource(registry),expected=structuredClone(registry);expected.domains['hzy-test.huizhi.yun'].apps.enterprise={deploymentCode:'C000001-test-enterprise'};assert.deepEqual(merged,expected);assert.equal(registry.domains['hzy-test.huizhi.yun'].apps.enterprise,undefined)
 assert.throws(()=>mergeEnterpriseSource({domains:{}}));merged.domains['hzy-test.huizhi.yun'].apps.enterprise.deploymentCode='other';assert.throws(()=>mergeEnterpriseSource(merged))
})
