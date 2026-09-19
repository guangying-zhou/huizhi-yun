import test from 'node:test'
import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {verifyOpenForWrappers} from './verify-open.mjs'
test('wrapper rollout requires a signed open snapshot and exact immutable actors',()=>{
 const actors=['aims','assets'].map(app=>({app,deployment:`C000001-test-${app}`,artifactSha256:'a'.repeat(64)}))
 const manifest={schemaVersion:'test-drain-wrappers.v1',tenant:'C000001',environment:'test',apps:actors.map(actor=>({app:actor.app,actor}))}
 const state={tenant:'C000001',environment:'test',mode:'open',revision:2,workerCredentialConfigured:true,contract:{actors}}
 const envelope=value=>{const payload=JSON.stringify(value);return {payload,alg:'HS256',signature:createHmac('sha256','fixture').update(payload).digest('hex')}}
 assert.equal(verifyOpenForWrappers(envelope(state),manifest,'fixture').verified,true)
 for(const patch of [{mode:'closed'},{mode:'sealed'},{workerCredentialConfigured:false},{tenant:'other'},{contract:{actors:[actors[0],{...actors[1],artifactSha256:'b'.repeat(64)}]}}])assert.throws(()=>verifyOpenForWrappers(envelope({...state,...patch}),manifest,'fixture'))
 assert.throws(()=>verifyOpenForWrappers(envelope(state),manifest,'wrong'))
})
