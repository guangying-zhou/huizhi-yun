import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {stripTypeScriptTypes} from 'node:module'

test('Host approval pagination rejects page/identity late replies and workbench uses full total',async()=>{
 const source=readFileSync(new URL('../app/composables/useHostPendingApprovals.ts',import.meta.url),'utf8')
 const script=stripTypeScriptTypes(source.replace(/^import .*$/gm,'').replace('export function','function').replace(/^export type .*$/gm,''))
 const calls=[],watches=[],mounted=[],fp={value:'P1'},page={value:1}
 const api=new Function('env',`with(env){${script};return useHostPendingApprovals(page);}`)({page,ref:value=>({value}),useNotifications:()=>({cacheFingerprint:fp}),watch:(target,fn)=>watches.push({target,fn}),onMounted:fn=>mounted.push(fn),onScopeDispose(){},sharedApiPath:path=>`/enterprise/api/foundation${path.slice(4)}`,$fetch:(url,options)=>new Promise(resolve=>calls.push({url,options,resolve}))})
 const first=api.refresh();page.value=2;const second=api.refresh()
 assert.equal(calls[0].options.signal.aborted,true)
 assert.equal(calls[0].url,'/enterprise/api/foundation/workflow-proxy/tasks/pending')
 calls[1].resolve({code:0,data:{items:[{task_id:11}],total:41,page:2,pageSize:20}});await second
 calls[0].resolve({code:0,data:{items:[{task_id:999}],total:999,page:1,pageSize:20}});await first
 assert.equal(api.total.value,41);assert.equal(api.tasks.value[0].task_id,11)
 const pending=api.refresh();fp.value='';watches.find(w=>w.target===fp).fn()
 calls[2].resolve({code:0,data:{items:[{task_id:777}],total:99,page:2,pageSize:20}});await pending
 assert.equal(calls[2].options.signal.aborted,true);assert.deepEqual(api.tasks.value,[]);assert.equal(api.total.value,0)
 await api.refresh();assert.equal(calls.length,3)
 const list=readFileSync(new URL('../app/pages/enterprise/approvals/index.vue',import.meta.url),'utf8')
 assert.match(list,/<UPagination/);assert.match(list,/共 {{ total }} 条/);assert.match(list,/returnPage/)
 const home=readFileSync(new URL('../app/pages/index.vue',import.meta.url),'utf8')
 assert.match(home,/String\(approvalTotal.value\)/);assert.doesNotMatch(home,/approvals\.value\.length\}\+/)
})
