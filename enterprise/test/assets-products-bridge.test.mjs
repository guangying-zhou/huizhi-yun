import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { registerHooks } from 'node:module'
import { existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createApp, createRouter, defineEventHandler, toNodeListener } from 'h3'

test('Assets Host routes preserve scoped authorization and forward the command key', async () => {
 const root=resolve(import.meta.dirname,'../..'),calls=[],checks=[]
 let denied=false,unavailable=false,relation=false,productOnly=false
 const session={authenticated:true,tokenUse:'access',subjectType:'user',uid:'person-a',tenant:'tenant-a',deployment:'enterprise-test'}
 const oldConfig=globalThis.useRuntimeConfig
 globalThis.useRuntimeConfig=()=>({public:{appCode:'enterprise'}})
 globalThis.__assetsSession=session
 globalThis.__assetsTransport=async(_event,path,options)=>{calls.push({path,options});return{handled:!unavailable,data:{code:0,data:{id:12}}}}
 globalThis.__assetsAuthorization=async(_event,uid,app,required)=>{checks.push({uid,app,...required});return{grants:denied?[]:[{permissions:[{appCode:app,resourceCode:productOnly?'products':required.resourceCode,action:productOnly?'edit':required.action}],scopes:relation?[{dimension:'asset',predicate:'owner'}]:[]}]}}
 const hooks=registerHooks({resolve(specifier,context,next){
  let source
  if(specifier.endsWith('/assetProductDocumentTransport'))source='export const readProductDocumentMetadataTransport=async()=>({})'
  if(specifier.endsWith('/consoleSessionBridge')||specifier==='./consoleSessionBridge')source='export const resolveConsoleAuthWithSessionBridge=async()=>globalThis.__assetsSession'
  if(specifier.endsWith('/tenantRuntimeClient')||specifier==='./tenantRuntimeClient')source='export const maybeCallTenantRuntime=(...args)=>globalThis.__assetsTransport(...args);export const verifiedServiceCommandActor=()=>null;export const prepareTenantRuntime=async()=>true'
  if(specifier.endsWith('/platformBundleAuthorization'))source='export const loadScopedAuthorizationFromConsoleRuntime=(...args)=>globalThis.__assetsAuthorization(...args)'
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
  for(const [route,method,file]of [['/products','get','products/index.get.ts'],['/products/:id','get','products/[id].get.ts'],['/products','post','products/index.post.ts'],['/products/:id','patch','products/[id].patch.ts'],['/dictionaries','get','dictionaries.get.ts'],['/categories','get','asset-categories.get.ts'],['/admin/categories','get','admin/asset-categories/index.get.ts'],['/admin/categories','post','admin/asset-categories/index.post.ts'],['/admin/categories/:id','put','admin/asset-categories/[id].put.ts']]){
   router.add(route,(await import('../server/routes/assets/api/v1/'+file)).default,method)
  }
  app.use(router);server=createServer(toNodeListener(app));await new Promise(done=>server.listen(0,'127.0.0.1',done))
  const base=`http://127.0.0.1:${server.address().port}`
  const request=async(path,method='GET',body,key='command-1')=>{const r=await fetch(base+path,{method,headers:{'content-type':'application/json','idempotency-key':key,'x-hzy-actor-uid':'forged'},body:body===undefined?undefined:JSON.stringify(body)});return{status:r.status,headers:r.headers,body:await r.json()}}
  for(const [path,method,body]of [['/products','POST',{product_code:'P-1',product_name:'One'}],['/products/12','PATCH',{product_name:'Two'}]]){
   const before=calls.length
   assert.equal((await request(path,method,body,'')).status,400);assert.equal(calls.length,before)
   denied=true;assert.equal((await request(path,method,body)).status,403);denied=false;assert.equal(calls.length,before)
   const r=await request(path,method,body);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store')
   const c=calls.at(-1);assert.equal(c.options.idempotencyKey,'command-1');assert.equal(c.options.scope,'assets:product:edit');assert.equal(c.options.appCode,'enterprise');assert.deepEqual(c.options.body.input,body)
   assert.equal(c.options.body.authorization.actorUid,session.uid);assert.equal(c.options.body.authorization.action,'edit');assert.equal(c.options.body.authorization.deployment,session.deployment)
  }
  for(const path of ['/products?actor=forged','/products?page=1&page=2','/products/0','/products/9007199254740993']){const before=calls.length;assert.equal((await request(path)).status,400);assert.equal(calls.length,before)}
  relation=true
  assert.equal((await request('/products?page=2&search=hello')).status,200)
  const list=calls.at(-1);assert.deepEqual({...list.options.body.query},{page:'2',search:'hello'});assert.equal(list.options.body.authorization.scope.current_user_assets_object_access,'relation');assert.equal(list.options.scope,'assets:product:read')
  for(const path of ['/products/12','/dictionaries','/categories?scope=product&pageSize=100'])assert.equal((await request(path)).status,200)
  assert.deepEqual(calls.at(-1).options.body.query,{scope:'product'})
  unavailable=true;assert.equal((await request('/products')).status,503)
  assert.ok(checks.every(c=>c.uid===session.uid&&c.app==='assets'&&['products','technology_bases','asset_items'].includes(c.resourceCode)))
  unavailable=false
  // Product editing never confers the separate category administration action.
  productOnly=true
  assert.equal((await request('/admin/categories')).status,403)
  productOnly=false
  // Existing Assets core treats an explicit resource admin grant as all scope.
  assert.equal((await request('/admin/categories')).status,200)
  relation=false
  assert.equal((await request('/admin/categories?scope=product&pageSize=100')).status,200)
  assert.equal(calls.at(-1).options.scope,'assets:admin:admin')
  for(const [path,method]of [['/admin/categories','POST'],['/admin/categories/2','PUT']]){
   const input={scope:'product',code:'LINE-1',name:'Line One'}
   const before=calls.length
   assert.equal((await request(path,method,input,'')).status,400)
   assert.equal((await request(path,method,{...input,scope:'equipment'})).status,400)
   assert.equal(calls.length,before)
   assert.equal((await request(path,method,input,'category-command')).status,200)
   const command=calls.at(-1)
   assert.equal(command.options.idempotencyKey,'category-command')
   assert.equal(command.options.scope,'assets:admin:admin')
   assert.equal(command.options.body.authorization.resource,'admin')
   assert.equal(command.options.body.authorization.action,'admin')
   assert.equal(command.options.body.authorization.actorUid,session.uid)
   assert.equal(command.options.body.authorization.scope.current_user_assets_object_access,'all')
  }
  for(const path of ['/admin/categories?scope=equipment','/admin/categories?actor=forged','/admin/categories?scope=product&scope=product'])assert.equal((await request(path)).status,400)
  assert.equal((await request('/admin/categories/0','PUT',{scope:'product'})).status,400)
  assert.equal((await request('/admin/categories/9007199254740993','PUT',{scope:'product'})).status,400)
 }finally{if(server){server.closeAllConnections();await new Promise(done=>server.close(done))}hooks.deregister();globalThis.useRuntimeConfig=oldConfig;delete globalThis.__assetsSession;delete globalThis.__assetsTransport;delete globalThis.__assetsAuthorization}
})
