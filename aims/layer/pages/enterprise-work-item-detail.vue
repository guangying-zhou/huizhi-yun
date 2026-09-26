<script setup lang="ts">
import { useAimsModule } from '../useAimsModule'

type WorkItem = Record<string, unknown> & { id: number, title?: string, itemKey?: string, completion?: { canRequest?: boolean, canReplay?: boolean, request?: { status?: string, workflow_instance_no?: string, operation_status?: string, operation_version?: number } } }
const route = useRoute()
const { moduleUrl } = useAimsModule()
const item = ref<WorkItem | null>(null)
const loading = ref(true)
const error = ref('')
const id = computed(() => String(route.params.id || ''))
const submitting = ref(false)
const completionKey = ref('')
const completionMessage = ref('')
const replayKey=ref('')
const stateKey=ref('')
const stateLabels:Record<string,string>={'plan-ready':'计划就绪',start:'开始执行',reset:'退回任务分解',reopen:'重新打开'}
async function transitionState(action:string){
 if(submitting.value||!(item.value?.stateActions as string[]|undefined)?.includes(action))return
 if(!await confirm({title:stateLabels[action]||'改变状态',message:`确认对“${item.value.title||'工作项'}”执行${stateLabels[action]}？`,confirmLabel:'确认'}))return
 submitting.value=true;error.value='';stateKey.value||=crypto.randomUUID()
 try{await $fetch(moduleUrl(`/api/v1/work-items/${id.value}/${action}`),{method:'POST',headers:{'Idempotency-Key':stateKey.value},body:{projectId:item.value.projectId,expectedVersion:item.value.editVersion}});stateKey.value='';await refresh()}catch(cause){error.value=cause instanceof Error?cause.message:'状态操作暂不可用，请重试'}finally{submitting.value=false}
}
const { confirm } = useConfirm()
const reviewPending=computed(()=>['queued','running'].includes(item.value?.completion?.request?.status||''))
const completionStatus=computed(()=>({queued:'待投递',running:'审批中',approved:'已通过',rejected:'已退回',cancelled:'已撤回'}[item.value?.completion?.request?.status||'']||''))

async function requestCompletion() {
  if (!item.value?.completion?.canRequest || submitting.value) return
  if (!await confirm({title:'提交完成审批',message:`提交“${item.value.title || '工作项'}”后，目标及子项将在审核期间冻结。审批通过后完成目标。`,tone:'warning',confirmLabel:'提交审批'})) return
  submitting.value = true
  error.value = ''
  completionKey.value ||= crypto.randomUUID()
  try {
    await $fetch(moduleUrl(`/api/v1/work-items/${id.value}/completion`), {method:'POST',headers:{'Idempotency-Key':completionKey.value},body:{projectId:item.value.projectId,expectedVersion:item.value.editVersion}})
    completionMessage.value = '完成审批请求已保存，等待可靠投递。审批结果会自动更新状态。'
    completionKey.value = ''
    await refresh()
  } catch (cause) {error.value = cause instanceof Error ? cause.message : '提交审批暂不可用，请重试'}
  finally {submitting.value = false}
}

async function replayCompletion(){
  if(!item.value?.completion?.canReplay||submitting.value)return
  if(!await confirm({title:'恢复审批投递',message:'请先修复审批配置或服务授权。此操作将使用原审批请求重新投递，不会创建新的完成申请。',confirmLabel:'已修复，重新投递'}))return
  submitting.value=true;error.value='';replayKey.value||=crypto.randomUUID()
  try{
    await $fetch(moduleUrl(`/api/v1/work-items/${id.value}/completion-replay`),{method:'POST',headers:{'Idempotency-Key':replayKey.value},body:{projectId:item.value.projectId,expectedOperationVersion:item.value.completion.request?.operation_version,reason:'审批配置或服务授权已修复，恢复原请求投递'}})
    replayKey.value='';completionMessage.value='原审批请求已恢复为待投递，请刷新查看结果。';await refresh()
  }catch(cause){error.value=cause instanceof Error?cause.message:'恢复投递暂不可用，请重试'}finally{submitting.value=false}
}

function value(...keys: string[]) {
  for (const key of keys) {
    const current = item.value?.[key]
    if (current !== undefined && current !== null && String(current).trim()) return String(current)
  }
  return '-'
}

async function refresh() {
  loading.value = true
  error.value = ''
  try {
    const response = await $fetch<{ code?: number, data?: WorkItem }>(moduleUrl(`/api/v1/work-items/${id.value}`))
    if (response.code !== 0 || !response.data) throw Error('工作项详情暂不可用')
    item.value = response.data
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '工作项详情暂不可用'
  } finally {
    loading.value = false
  }
}

watch(id, refresh)
onMounted(refresh)
</script>

<template>
  <section class="space-y-5">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <UButton :to="moduleUrl('/work-items')" variant="link" color="neutral" icon="i-lucide-arrow-left">返回工作项</UButton>
        <h1 class="mt-1 text-2xl font-semibold text-highlighted">{{ item?.title || '工作项详情' }}</h1>
        <p class="mt-1 text-sm text-muted">{{ value('itemKey') }}</p>
      </div>
      <div class="flex flex-wrap gap-2"><UButton v-if="item?.completion?.canRequest" :loading="submitting" @click="requestCompletion">提交完成审批</UButton><UButton v-if="item?.completion?.canReplay" :loading="submitting" variant="soft" @click="replayCompletion">恢复审批投递</UButton><UButton :disabled="reviewPending" :to="moduleUrl(`/work-items/${id}/edit`)" icon="i-lucide-pencil">编辑基本信息</UButton><UButton v-if="item?.tier === 'target'" :disabled="reviewPending" :to="moduleUrl(`/work-items/${id}/association`)" variant="soft">版本关联</UButton><UButton v-if="item?.tier === 'target' && item?.type !== 'requirement'" :to="moduleUrl(`/work-items/${id}/breakdown`)" variant="soft" icon="i-lucide-list-tree">任务分配</UButton><UButton icon="i-lucide-refresh-cw" variant="soft" color="neutral" :loading="loading" @click="refresh">刷新</UButton></div>
    </div>
    <UAlert v-if="error" color="error" icon="i-lucide-circle-alert" title="无法读取工作项" :description="error" />
    <USkeleton v-else-if="loading" class="h-64 w-full" />
    <template v-else-if="item">
      <div class="flex flex-wrap gap-2"><UButton v-for="action in (item.stateActions as string[] || [])" :key="action" :disabled="reviewPending" :loading="submitting" variant="soft" @click="transitionState(action)">{{ stateLabels[action] || action }}</UButton></div>
      <UAlert color="info" icon="i-lucide-info" title="迁移范围" description="支持基本信息、产品版本关联、开始执行、退回任务分解、重新打开、非需求目标的完成审批，以及任务分配页面中的分解保存、确认/撤回分配、追加任务及其确认/拒绝；需求分解提交仍待迁移。" />
      <UAlert v-if="completionMessage" color="success" :title="completionMessage" />
      <UAlert v-if="item.completion?.request" color="info" title="最近完成审批" :description="`${item.completion.request.workflow_instance_no || '待投递'} · ${completionStatus}`" />
      <UAlert v-if="['failed_permanent','dead_letter'].includes(item.completion?.request?.operation_status || '')" color="warning" title="审批投递需要人工处理" description="管理员修复流程配置或服务授权后，可恢复原请求投递。此类配置错误不会无限自动重试。" />
      <UCard>
        <dl class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <div><dt class="text-sm text-muted">项目</dt><dd class="mt-1 font-medium">#{{ value('projectId') }}</dd></div>
          <div><dt class="text-sm text-muted">状态</dt><dd class="mt-1 font-medium">{{ value('status') }}</dd></div>
          <div><dt class="text-sm text-muted">类型</dt><dd class="mt-1 font-medium">{{ value('type') }}</dd></div>
          <div><dt class="text-sm text-muted">优先级</dt><dd class="mt-1 font-medium">{{ value('priority') }}</dd></div>
          <div><dt class="text-sm text-muted">负责人</dt><dd class="mt-1 font-medium">{{ value('assigneeUid') }}</dd></div>
          <div><dt class="text-sm text-muted">截止日期</dt><dd class="mt-1 font-medium">{{ value('dueDate') }}</dd></div>
          <div><dt class="text-sm text-muted">里程碑</dt><dd class="mt-1 font-medium">{{ value('milestoneName') }}</dd></div>
          <div><dt class="text-sm text-muted">预计工时</dt><dd class="mt-1 font-medium">{{ value('estimatedHours') }}</dd></div>
          <div><dt class="text-sm text-muted">更新时间</dt><dd class="mt-1 font-medium">{{ value('updatedAt') }}</dd></div>
        </dl>
        <p v-if="value('description') !== '-'" class="mt-6 whitespace-pre-wrap text-sm text-default">{{ value('description') }}</p>
      </UCard>
    </template>
  </section>
</template>
