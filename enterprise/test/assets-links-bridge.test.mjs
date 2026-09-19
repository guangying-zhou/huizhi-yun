import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('product links bind independent scope, live document ACL, identity and retry key', async () => {
 const root=resolve(import.meta.dirname,'../..'),calls=[],checks=[],documents=[]
 let denyTarget=false,denyDoc=false,unavailable=false
 const session={authenticated:true,tokenUse:'access',subjectType:'user',uid:'person-a',tenant:'tenant-a',deployment:'enterprise-test'}
 const previous=globalThis.useRuntimeConfig
 globalThis.useRuntimeConfig=()=>({public:{appCode:'enterprise'}})
 globalThis.__linkSession=session
 globalThis.__linkTransport=async(_event,path,options)=>{calls.push({path,options});return{handled:!unavailable,data:{code:0,data:path.endsWith(':view')?{product_code:'PROD-A'}:{id:12}}}}
 globalThis.__linkAuth=async(_event,uid,app,required)=>{checks.push({uid,app,...required});return{grants:denyTarget&&required.resourceCode!=='products'?[]:[{permissions:[{appCode:app,resourceCode:required.resourceCode,action:required.action}],scopes:required.resourceCode==='products'?[]:[{dimension:'asset',predicate:'owner'}]}]}}
 globalThis.__linkDocs=async(...args)=>{documents.push(args.slice(1));if(denyDoc)throw Object.assign(new Error('document denied'),{statusCode:403});return{uuid:args[2]}}
 const hooks=registerHooks({resolve(specifier,context,next){
  let source
  if(specifier.endsWith('/consoleSessionBridge')||specifier==='./consoleSessionBridge')source='export const resolveConsoleAuthWithSessionBridge=async()=>globalThis.__linkSession'
  if(specifier.endsWith('/tenantRuntimeClient')||specifier==='./tenantRuntimeClient')source='export const maybeCallTenantRuntime=(...args)=>globalThis.__linkTransport(...args);export const verifiedServiceCommandActor=()=>null;export const prepareTenantRuntime=async()=>true'
  if(specifier.endsWith('/platformBundleAuthorization'))source='export const loadScopedAuthorizationFromConsoleRuntime=(...args)=>globalThis.__linkAuth(...args)'
  if(specifier.endsWith('/assetProductDocumentTransport'))source='export const readProductDocumentMetadataTransport=(...args)=>globalThis.__linkDocs(...args)'
  if(source)return{url:`data:text/javascript,${encodeURIComponent(source)}`,shortCircuit:true}
  let candidate
  if(specifier.startsWith('@hzy/foundation/'))candidate=resolve(root,'foundation',specifier.slice('@hzy/foundation/'.length))
  else if(specifier.startsWith('~~/'))candidate=resolve(root,'enterprise',specifier.slice(3))
  else if(specifier.startsWith('.')&&context.parentURL?.startsWith('file:'))candidate=resolve(dirname(fileURLToPath(context.parentURL)),specifier)
  if(candidate&&!existsSync(candidate)&&existsSync(candidate+'.ts'))return{url:pathToFileURL(candidate+'.ts').href,shortCircuit:true}
  return next(specifier,context)
 }})
 let server
 try{
  const app=createApp(),router=createRouter()
  app.use(defineEventHandler(e=>{e.context.consoleAuth=session}))
  for(const kind of ['bases','assets','documents'])router.post('/products/:id/'+kind,(await import(`../server/routes/assets/api/v1/products/[id]/${kind}.post.ts`)).default)
  for(const kind of ['bases','assets'])router.get('/candidates/'+kind,(await import(`../server/routes/assets/api/v1/products/link-candidates/${kind}.get.ts`)).default)
  app.use(router);server=createServer(toNodeListener(app));await new Promise(done=>server.listen(0,'127.0.0.1',done))
  const base=`http://127.0.0.1:${server.address().port}`
  const request=async(path,body,key='retry-1')=>{const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json','idempotency-key':key},body:body===undefined?undefined:JSON.stringify(body)});return r.status}
  for(const [kind,input,target]of [['bases',{technology_base_id:11},'technology_bases'],['assets',{asset_id:21,is_primary:true},'asset_items']]){
   denyTarget=true;let n=calls.length
   assert.equal(await request('/products/12/'+kind,input),403);assert.equal(calls.length,n)
   denyTarget=false
   assert.equal(await request('/products/12/'+kind,input,''),400);assert.equal(calls.length,n)
   assert.equal(await request('/products/12/'+kind,input),200)
   const c=calls.at(-1);assert.equal(c.options.idempotencyKey,'retry-1');assert.equal(c.options.scope,'assets:product:edit');assert.equal(c.options.body.authorization.resource,'products');assert.equal(c.options.body.authorization.action,'edit');assert.equal(c.options.body.targetAuthorization.resource,target);assert.equal(c.options.body.targetAuthorization.scope.current_user_assets_object_access,'relation');assert.equal(c.options.body.authorization.actorUid,session.uid)
   assert.equal(await request('/candidates/'+kind),200);assert.equal(calls.at(-1).options.scope,'assets:product:read')
  }
  const doc={document_id:'00000000-0000-4000-8000-000000000001',document_type:'design'}
  denyDoc=true;let n=calls.length
  assert.equal(await request('/products/12/documents',doc),403);assert.equal(calls.length,n+1);assert.ok(calls.at(-1).path.endsWith(':view'))
  denyDoc=false
  assert.equal(await request('/products/12/documents',doc),200)
  assert.deepEqual(documents.at(-1),['PROD-A',doc.document_id,session.uid,'enterprise'])
  const command=calls.at(-1);assert.ok(command.path.endsWith(':link-document'));assert.equal(command.options.idempotencyKey,'retry-1');assert.equal(command.options.body.documentAuthorization.productCode,'PROD-A');assert.equal(command.options.body.documentAuthorization.actorUid,session.uid)
  n=calls.length
  assert.equal(await request('/products/12/documents',{...doc,documentAuthorization:{actorUid:'forged'}}),400);assert.equal(calls.length,n)
  assert.equal(await request('/products/0/bases',{technology_base_id:1}),400)
  unavailable=true;assert.equal(await request('/candidates/bases'),503)
 }finally{hooks.deregister();globalThis.useRuntimeConfig=previous;if(server)await new Promise(done=>server.close(done))}
})
