import test from 'node:test'
import assert from 'node:assert/strict'
import { activeEnterprisePersonnelUID, lookupActiveEnterprisePersonnelUID } from '../server/utils/enterpriseAimsPersonnelContract'
test('Console personnel projection requires exact UID and explicit active status',()=>{
 assert.equal(activeEnterprisePersonnelUID({uid:'U1',active:true},'U1'),'U1')
 for(const row of [null,{},[],{uid:'U2',active:true},{uid:'U1',active:false},{uid:'U1'},{uid:'U1',active:'true'}])assert.throws(()=>activeEnterprisePersonnelUID(row,'U1'))
})
test('personnel lookup is bounded, uncached and fails closed on Directory outage',async()=>{
 let calls=0
 const fetch=async(uids:string[])=>{assert.deepEqual(uids,['U1']);calls++;return [{uid:'U1',active:calls===1}]}
 assert.equal(await lookupActiveEnterprisePersonnelUID('U1',fetch),'U1')
 await assert.rejects(lookupActiveEnterprisePersonnelUID('U1',fetch),{statusCode:403})
 assert.equal(calls,2)
 await assert.rejects(lookupActiveEnterprisePersonnelUID('U1',async()=>{throw Error('upstream')}),{statusCode:503})
})
