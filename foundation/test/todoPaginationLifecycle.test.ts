import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import { todoReadQuery } from '../shared/utils/todoReadQuery'

test('todo query keeps legacy cursor limits and validates strict opt-in page mode',()=>{
 assert.deepEqual(todoReadQuery({todoKind:'approval',cursor:'old+cursor',limit:'50'},true),{todoKind:'approval',cursor:'old+cursor',limit:50})
 assert.deepEqual(todoReadQuery({page:'2',pageSize:'100'},true),{page:'2',pageSize:'100'})
 assert.deepEqual(todoReadQuery({source_app_code:'aims',todo_kind:'risk',page:'1'}),{sourceAppCode:'aims',todoKind:'risk',page:'1'})
 for(const q of [{page:''},{page:'01'},{page:'0'},{page:['1','2']},{pageSize:'101'},{page:'1',cursor:''},{page:'1',limit:'20'},{todoKind:'all'},{cursor:'x'.repeat(513)},{category:['a','b']},{todoKind:'due',todo_kind:'risk'}]) assert.throws(()=>todoReadQuery(q as any,true))
})
test('Host todos ignores superseded page and revoked detail replies before receipt/navigation',async()=>{
 const source=readFileSync(new URL('../app/components/TodoList.vue',import.meta.url),'utf8')
 assert.match(source,/共 {{ total }} 条/);assert.match(source,/<UPagination/)
 const script=stripTypeScriptTypes(source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)![1]!.replace(/^import .*$/gm,''))
 const calls:any[]=[],watches:any[]=[],reads:any[]=[],navigations:any[]=[]
 const fp={value:'P1'},page={value:1},mounted:any[]=[],counts={approval:2,due:1,risk:1,follow_up:1}
 let detailResolve:any
 const run=new Function('env',`with(env){${script};return {loadTodos,selectKind,items,total,kindCounts,page,openTodo};}`)
 const ui=run({defineProps:()=>({apiPath:'/enterprise/api/notifications/todos',serverPagination:true,hosted:true,panelUi:{}}),withDefaults:(x:any)=>x,
  ref:(value:any)=>({value}),usePageTitle(){},useUserApplications:()=>({apps:{value:[]},loadApps:async()=>{}}),
  useNotifications:()=>({cacheFingerprint:fp,loadDetail:()=>new Promise(resolve=>detailResolve=resolve),markRead:async(id:string)=>reads.push(id)}),
  useRoute:()=>({query:{}}),useToast:()=>({add(){}}),useListPage:()=>({page,pageSize:20}),watch:(target:any,fn:any)=>watches.push({target,fn}),onScopeDispose(){},onMounted:(fn:any)=>mounted.push(fn),
  $fetch:(_url:any,options:any)=>new Promise(resolve=>calls.push({options,resolve})),resolveNotificationActionUrl:()=>'/enterprise/approvals/11',hostNotificationTarget:()=>null,window:{location:{origin:'https://host.test'}},navigateTo:async(url:string)=>navigations.push(url)
 })
 const first=ui.loadTodos();page.value=2;const second=ui.loadTodos()
 assert.equal(calls[0].options.signal.aborted,true)
 calls[1].resolve({data:{items:[{notificationId:'N2'}],total:41,page:2,pageSize:20,kindCounts:counts}});await second
 calls[0].resolve({data:{items:[{notificationId:'STALE'}],total:999,page:1,pageSize:20,kindCounts:counts}});await first
 assert.equal(ui.items.value[0].notificationId,'N2');assert.equal(ui.total.value,41)
 const opening=ui.openTodo({notificationId:'N2'})
 const pending=ui.loadTodos();fp.value='';watches.find(w=>w.target===fp).fn()
 assert.equal(calls[2].options.signal.aborted,true)
 calls[2].resolve({data:{items:[{notificationId:'SECRET'}],total:41,page:2,pageSize:20,kindCounts:counts}});await pending
 detailResolve({body:'SECRET'});await opening
 assert.deepEqual(ui.items.value,[]);assert.equal(ui.total.value,0);assert.deepEqual(reads,[]);assert.deepEqual(navigations,[])
 await ui.loadTodos();assert.equal(calls.length,3)
})
