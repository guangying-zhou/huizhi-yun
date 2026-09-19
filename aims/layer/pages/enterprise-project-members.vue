<script setup lang="ts">
import { useAimsModule } from '../useAimsModule'

type ProjectMember = { id: number, uid: string, role?: string, status?: string, createdAt?: string, updatedAt?: string, created_at?: string, updated_at?: string }
const route = useRoute()
const { moduleUrl } = useAimsModule()
const projectId = computed(() => String(route.params.id || ''))
const search = ref('')
const items = ref<ProjectMember[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref('')
const canManage=ref(false)
const operationKey=ref(''),showAdd=ref(false),uid=ref(''),role=ref('member'),saving=ref(false)
const selectedUids=computed({get:()=>uid.value?[uid.value]:[],set:(values:string[])=>{uid.value=values[0]||''}})
async function write(action:'add'|'role'|'remove',target:string,nextRole=''){saving.value=true;operationKey.value||=crypto.randomUUID();try{await $fetch(moduleUrl(`/api/v1/projects/${projectId.value}/members`),{method:action==='add'?'POST':action==='role'?'PUT':'DELETE',headers:{'Idempotency-Key':operationKey.value},body:{uid:target,...(action==='remove'?{}:{role:nextRole})}});operationKey.value='';showAdd.value=false;uid.value='';await refresh()}catch(cause){error.value=cause instanceof Error?cause.message:'成员操作失败，可使用相同操作标识重试'}finally{saving.value=false}}

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const detail=await $fetch<{code?:number,data?:Record<string,unknown>}>(moduleUrl(`/api/v1/projects/${projectId.value}`))
    canManage.value=detail.code===0&&(detail.data?.current_user_role==='manager'||detail.data?.currentUserRole==='manager')
    const response = await $fetch<{ code?: number, data?: { items?: ProjectMember[], total?: number } }>(moduleUrl(`/api/v1/projects/${projectId.value}/members`), {
      query: { ...(search.value.trim() ? { search: search.value.trim() } : {}) }
    })
    if (response.code !== 0) throw Error('项目成员暂不可用')
    items.value = Array.isArray(response.data?.items) ? response.data.items : []
    total.value = Number(response.data?.total || items.value.length)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '项目成员暂不可用'
  } finally {
    loading.value = false
  }
}

watch(projectId, refresh)
onMounted(refresh)
</script>

<template>
  <section class="space-y-5">
    <div>
      <UButton :to="moduleUrl(`/projects/${projectId}`)" variant="link" color="neutral" icon="i-lucide-arrow-left">返回项目</UButton>
      <h1 class="mt-1 text-2xl font-semibold text-highlighted">项目成员</h1>
      <p class="mt-1 text-sm text-muted">项目经理可以添加成员、调整角色或移除无在办工作项的成员。</p>
    </div>
    <div class="flex max-w-xl gap-3">
      <UInput v-model="search" class="flex-1" icon="i-lucide-search" placeholder="搜索成员 UID、角色或状态" @keyup.enter="refresh" />
      <UButton :loading="loading" @click="refresh">查询</UButton>
      <UButton v-if="canManage" @click="showAdd=true">添加成员</UButton>
    </div>
    <UAlert v-if="error" color="error" icon="i-lucide-circle-alert" title="无法读取成员" :description="error" />
    <UTable :data="items" :loading="loading" :columns="[
      { accessorKey: 'uid', header: '成员 UID' }, { accessorKey: 'role', header: '项目角色' },
      { accessorKey: 'status', header: '状态' }, { accessorKey: 'updatedAt', header: '更新时间' }
    ]">
      <template #role-cell="{ row }">{{ row.original.role || '-' }}</template>
      <template #status-cell="{ row }"><UBadge color="neutral" variant="subtle">{{ row.original.status || '-' }}</UBadge></template>
      <template #updatedAt-cell="{ row }">{{ row.original.updatedAt || row.original.updated_at || row.original.createdAt || row.original.created_at || '-' }}</template>
      <template #empty><CommonEmptyState icon="i-lucide-users" title="暂无项目成员" description="当前项目没有可显示的成员。" /></template>
    </UTable>
    <p class="text-sm text-muted">共 {{ total }} 名成员</p>
    <UCard v-if="showAdd&&canManage"><div class="flex gap-3"><UserTreeSelector v-model="selectedUids" selection-mode="single" :exclude-uids="items.map(member=>member.uid)"/><USelect v-model="role" :items="[{label:'项目经理',value:'manager'},{label:'成员',value:'member'},{label:'观察者',value:'viewer'}]"/><UButton :loading="saving" :disabled="!uid.trim()" @click="write('add',uid,role)">确认添加</UButton></div></UCard>
    <div v-if="items.length&&canManage" class="space-y-2"><div v-for="member in items" :key="member.id" class="flex items-center gap-2"><span class="w-48">{{ member.uid }}</span><UButton size="xs" variant="soft" @click="write('role',member.uid,member.role==='manager'?'member':'manager')">{{ member.role==='manager'?'改为成员':'设为经理' }}</UButton><UButton size="xs" color="error" variant="soft" @click="write('remove',member.uid)">移除</UButton></div></div>
  </section>
</template>
