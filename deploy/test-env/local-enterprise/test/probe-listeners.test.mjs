import test from 'node:test'
import assert from 'node:assert/strict'
import { expectedListeners, probeListeners } from '../probe-listeners.mjs'
const profile={identity:{consoleFacadeMode:'local-canonical-facade'},features:{workflowLocal:true,codocsCollaborationV2:true},publicOrigin:'https://fixture.example',listeners:Object.fromEntries(['gatewayIngress','gatewayInternal','enterprise','codocsEditor','workflow','aims','collab'].map((k,i)=>[k,{host:'127.0.0.1',port:23000+i}]))}
test('switch gate covers all enabled app listeners including both Gateway ports',async()=>{
 assert.deepEqual(expectedListeners(profile).map(x=>x.name),['gatewayIngress','gatewayInternal','enterprise','codocsEditor','console','workflow','aims','collab'])
 for(const status of [200,302]) assert.equal((await probeListeners(profile,async()=>true,async()=>new Response(null,{status}))).healthy,true)
 const missing=await probeListeners(profile,async item=>item.name!=='gatewayIngress',async()=>new Response(null,{status:200}))
 assert.equal(missing.healthy,false)
 for(const status of [401,502]) assert.equal((await probeListeners(profile,async()=>true,async()=>new Response(null,{status}))).healthy,false)
 assert.equal((await probeListeners(profile,async()=>true,async()=>{throw Error('network')})).healthy,false)
})
