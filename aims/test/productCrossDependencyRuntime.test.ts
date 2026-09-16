import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { createError } from 'h3'
import * as input from '../server/utils/productCrossDependencyInput'
import * as workspace from '../server/utils/productWorkspaceInput'
const item='00000000-0000-4000-8000-000000000001',pred='00000000-0000-4000-8000-000000000002',edge='00000000-0000-4000-8000-000000000003'
const body={predecessorProductCode:'P-B',predecessorId:pred,expectedRevision:1,expectedItemRevision:1,expectedPredecessorProductRevision:2,expectedPredecessorRevision:1,reason:'共享能力'}
const compiled=ts.transpileModule(readFileSync(new URL('../server/utils/productCrossDependencyRuntime.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
function harness(options:{path?:string,query?:Record<string,unknown>,remove?:boolean,denyTarget?:boolean,mixedActor?:boolean,method?:string,unavailable?:boolean,discoveryRevision?:number,permissionUnavailable?:boolean,editDenied?:boolean}={}){
 const calls:any[]=[],permissions:string[]=[],exports:any={}
 runInNewContext(compiled,{exports,require:(name:string)=>{
 if(name==='h3')return {createError,getRouterParam:(_:unknown,key:string)=>key==='productCode'?'P-A':options.path??`items/${item}${options.remove?`/${edge}/remove`:''}`,getQuery:()=>options.query??({}),getHeader:()=> 'cross-key',readBody:async()=>({...body,...(options.remove?{expectedDependencyRevision:3}:{})}),setHeader:()=>{}}
 if(name==='./productCrossDependencyInput')return input
 if(name==='./productWorkspaceInput')return workspace
 if(name==='./productAuthorization')return {checkProductPermission:async(_:unknown,code:string)=>{if(options.permissionUnavailable)throw createError({statusCode:503});return {allowed:code!=='P-C'&&!options.editDenied,facts:{product_code:code,actor_uid:options.mixedActor?'other':'pm',revision:1}}},requireProductPermission:async(_:unknown,code:string,resource:string,action:string)=>{permissions.push(`${code}:${resource}:${action}`);if(code==='P-B'&&options.denyTarget)throw createError({statusCode:403});return {revision:1,product_code:code,actor_uid:code==='P-B'&&options.mixedActor?'other':'pm'}}}
 if(name.endsWith('/tenantRuntimeClient'))return {maybeCallTenantRuntime:async(_:unknown,path:string,args:unknown)=>{calls.push({path,args});return {handled:!options.unavailable,data:{code:0,data:path.endsWith(':targets')?{product_code:'P-A',item_biz_id:item,workspace_revision:options.discoveryRevision??1,product_codes:['P-B','P-C']}:{}}}}}
 if(name==='./aimsRuntimeForward')return {runtimeEnvelopeError:()=>createError({statusCode:409})}
 throw new Error(name)
 }})
 return {run:()=>exports.handleProductCrossDependency({method:options.method??'POST'}),calls,permissions}
}
test('cross dependency create and remove forward independently authorized products',async()=>{
 for(const remove of [false,true]){
 const h=harness({remove});await h.run()
 assert.deepEqual(h.permissions,['P-A:product_priorities:edit','P-B:product_priorities:view'])
 assert.equal(h.calls[0].args.scope,`aims.write aims:product-priorities:cross-dependency-${remove?'remove':'create'}`)
 assert.equal(h.calls[0].args.body.input.item_biz_id,item)
 assert.equal(h.calls[0].args.body.input.dependency_biz_id,remove?edge:undefined)
 assert.equal(h.calls[0].args.body.predecessor_authorization.facts.product_code,'P-B')
 assert.equal(h.calls[0].args.idempotencyKey,'cross-key')
 }
})
test('cross dependency refuses denied target and actor changes before transport',async()=>{
 for(const [options,statusCode] of [[{denyTarget:true},403],[{mixedActor:true},409],[{method:'PUT'},405]] as const){const h=harness(options);await assert.rejects(h.run(),{statusCode});assert.equal(h.calls.length,0)}
 await assert.rejects(harness({unavailable:true}).run(),{statusCode:503})
})

test('cross dependency detail binds edge and requires both view permissions',async()=>{
 const base={path:`edges/${edge}`,method:'GET',query:{predecessorProductCode:'P-B'}}
 const h=harness(base);await h.run()
 assert.deepEqual(h.permissions,['P-A:product_priorities:view','P-B:product_priorities:view'])
 assert.equal(h.calls[0].args.scope,'aims.read aims:product-priorities:read')
 assert.equal(h.calls[0].args.body.input.biz_id,edge)
 assert.equal(h.calls[0].args.idempotencyKey,undefined)
 for(const query of [{},{predecessorProductCode:'P-A'},{predecessorProductCode:['P-B']},{predecessorProductCode:'P-B',actor:'other'}])await assert.rejects(harness({...base,query}).run(),{statusCode:400})
 const denied=harness({...base,denyTarget:true});await assert.rejects(denied.run(),{statusCode:403});assert.equal(denied.calls.length,0)
})

test('filtered dependency list authorizes every requested predecessor product',async()=>{
 const base={path:`items/${item}`,method:'GET',query:{predecessorProductCode:['P-B','P-C'],page:'2',pageSize:'10'}}
 const h=harness(base);await h.run()
 assert.deepEqual(h.permissions,['P-A:product_priorities:view','P-B:product_priorities:view','P-C:product_priorities:view'])
 assert.equal(h.calls[0].args.body.input.page,2)
 assert.equal(h.calls[0].args.body.input.item_biz_id,item)
 assert.deepEqual(Object.keys(h.calls[0].args.body.predecessor_authorizations),['P-B','P-C'])
 for(const query of [{predecessorProductCode:[]},{predecessorProductCode:['P-B','P-B']},{predecessorProductCode:'P-A'},{predecessorProductCode:'P-B',page:'0'},{predecessorProductCode:'P-B',authorization:'forged'}])await assert.rejects(harness({...base,query}).run(),{statusCode:400})
 const denied=harness({...base,denyTarget:true});await assert.rejects(denied.run(),{statusCode:403});assert.equal(denied.calls.length,0)
})

test('automatic dependency list keeps discovery server-side and excludes denied products',async()=>{
 const h=harness({path:`items/${item}`,method:'GET'});const result=await h.run()
 assert.equal(h.calls.length,2)
 assert.ok(h.calls[0].path.endsWith(':targets'))
 assert.ok(h.calls[1].path.endsWith(':list'))
 assert.deepEqual(Object.keys(h.calls[1].args.body.predecessor_authorizations),['P-B'])
 assert.equal(result.data.product_codes,undefined)
})

 test('automatic discovery refuses stale facts and preserves authorization outages',async()=>{
 for(const [options,statusCode] of [[{discoveryRevision:2},409],[{mixedActor:true},409],[{permissionUnavailable:true},503]] as const){
  const h=harness({path:`items/${item}`,method:'GET',...options})
  await assert.rejects(h.run(),{statusCode})
  assert.equal(h.calls.length,1)
  assert.ok(h.calls[0].path.endsWith(':targets'))
 }
})

test('dependency permissions bind view and edit facts without granting writes',async()=>{
 for(const denied of [false,true]){
  const h=harness({path:'permissions',method:'GET',editDenied:denied})
  const result=await h.run()
  assert.equal(result.data.product_code,'P-A')
  assert.equal(result.data.revision,1)
  assert.equal(result.data.edit,!denied)
  assert.equal(h.calls.length,0)
 }
 for(const [options,statusCode] of [[{mixedActor:true},409],[{permissionUnavailable:true},503],[{query:{actor:'forged'}},400],[{method:'POST'},405]] as const){
  await assert.rejects(harness({path:'permissions',method:'GET',...options}).run(),{statusCode})
 }
})
