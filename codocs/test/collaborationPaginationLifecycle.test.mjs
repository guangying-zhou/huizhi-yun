import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'

test('collaboration page uses server tab totals/options and isolates stale list/preview responses', async () => {
  const source = readFileSync(new URL('../app/pages/mydocs/shared.vue', import.meta.url), 'utf8')
  assert.match(source, /<UPagination[\s\S]*?:total="total"/)
  assert.match(source, /共 {{ total }} 条/)
  const script = stripTypeScriptTypes(source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1].replace(/^import .*$/gm, '').replace('await refresh()', ''))
  const calls = [], watches = [], disposed = [], user = {value:'alice'}
  let viewer = 'alice-policy-1'
  const ref = value => ({value})
  const run = new Function('env', `with(env) { ${script}; return {refresh,page,sharedTab,visibleItems,total,ownerOptions,deptOptions,loadPreview,previewContent,data}; }`)
  const ui = run({
    ref, computed: fn => ({get value(){return fn()}}), definePageMeta() {}, usePageTitle() {},
    useAuth: () => ({user}), useCodocsModule: () => ({moduleUrl:x=>`/codocs${x}`, documentUrl:x=>x,cacheKey:()=>viewer,hosted:true}),
    useRouter: () => ({push() {}}), useAccountStore: () => ({getUserByUid:()=>undefined,getDepartmentById:()=>undefined,fetchUsersBatch:async()=>{},fetchDepartments:async()=>{}}),
    usePermissions: () => ({hasPermission:()=>false,loadPermissions:async()=>{}}),useDocumentPreviewBootstrap:()=>({setPayload(){}}),useResizablePanel:()=>({}),
    useDebouncedSearch:()=>({search:ref(''),debounced:ref(''),flush(){},reset(){}}),useListPage:()=>({page:ref(2),pageSize:20}),
    watch: (target,fn)=>watches.push({target,fn}),onScopeDispose:fn=>disposed.push(fn),AbortController,
    $fetch:(url,options)=>new Promise(resolve=>calls.push({url,options,resolve}))
  })
  const pageData = {items:[{uuid:'D1',ownerUid:'a',relationTypes:['shared_to_me']}],total:41,page:2,pageSize:20,ownerUids:['a','b'],deptCodes:['D1','D2']}
  const first = ui.refresh()
  assert.equal(calls[0].options.params.sharedTab, 'received')
  calls[0].resolve({code:0,data:pageData}); await first
  assert.equal(ui.total.value,41)
  assert.equal(ui.ownerOptions.value.length,3)
  assert.equal(ui.deptOptions.value.length,3)
  const stale = ui.refresh(); ui.sharedTab.value = 'sent'
  calls[1].resolve({code:0,data:pageData}); await stale
  assert.equal(ui.data.value,null)
  const list = ui.refresh()
  calls[2].resolve({code:0,data:pageData}); await list
  const preview = ui.loadPreview('D1')
  user.value = null; viewer = 'signed-out'
  await watches.find(w=>typeof w.target==='function').fn()
  assert.equal(calls[3].options.signal.aborted,true)
  calls[3].resolve({success:true,data:{content:'SECRET'}}); await preview
  assert.equal(ui.previewContent.value,'')
  assert.equal(ui.data.value,null)
  await ui.refresh()
  assert.equal(calls.length,4)
  disposed.forEach(fn=>fn())
})
