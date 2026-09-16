import test from 'node:test'
import assert from 'node:assert/strict'
import { crossDependencyWriteInput } from '../server/utils/productCrossDependencyInput'
const item='00000000-0000-4000-8000-000000000001',pred='00000000-0000-4000-8000-000000000002',edge='00000000-0000-4000-8000-000000000003'
const body={predecessorProductCode:'P-B',predecessorId:pred,expectedRevision:1,expectedItemRevision:2,expectedPredecessorProductRevision:3,expectedPredecessorRevision:4,reason:'依赖共享能力'}
test('cross dependency binds source item and removal edge with complete revisions',()=>{
 const created=crossDependencyWriteInput(body,'P-A',item)
 assert.equal(created?.item_biz_id,item)
 assert.equal(created?.predecessor_biz_id,pred)
 assert.equal(created?.impact_note,'')
 assert.equal(created?.expected_predecessor_revision,4)
 const removed=crossDependencyWriteInput({...body,expectedDependencyRevision:5},'P-A',item,edge)
 assert.equal(removed?.dependency_biz_id,edge)
 assert.equal(removed?.expected_dependency_revision,5)
 assert.equal(crossDependencyWriteInput(body,'P-A',item,edge),null)
})
test('cross dependency rejects authority overrides, same product, self and malformed inputs',()=>{
 for(const change of [{authorization:{}},{actor_uid:'other'},{item_biz_id:pred},{predecessorProductCode:'P-A'},{predecessorProductCode:'P/B'},{predecessorProductCode:' P-B'},{predecessorId:item},{expectedRevision:'1'},{expectedPredecessorRevision:0},{reason:''},{impactNote:'\0'},{expectedDependencyRevision:1}]) assert.equal(crossDependencyWriteInput({...body,...change},'P-A',item),null)
 assert.equal(crossDependencyWriteInput(body,'P-A','invalid'),null)
})
