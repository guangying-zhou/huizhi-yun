<script setup lang="ts">
import { useAimsModule } from '../../../layer/useAimsModule'
import { projectWorkflowActionConfigs } from '../../utils/projectWorkflow'
import WorkflowTimeline from '@hzy/foundation/app/components/WorkflowTimeline.vue'
import type { WorkflowByBizResult } from '@hzy/foundation/app/types/workflow'

type LifecycleAction = 'pause' | 'resume' | 'finish'
const props = defineProps<{ projectId: string, name: string, status: string, expectedVersion: string, canManage: boolean }>()
const emit = defineEmits<{ refresh: [] }>()
const { moduleUrl, cacheKey } = useAimsModule()
const { hasPermission } = usePermissions()
const { user: currentUid } = useAuth()
const { confirm } = useConfirm()
const toast = useToast()
const action = ref<LifecycleAction>('pause')
const comment = ref('')
const open = ref(false)
const saving = ref(false)
const reading = ref(false)
const error = ref('')
const readError = ref('')
const instances = ref<Partial<Record<LifecycleAction, WorkflowByBizResult | null>>>({})
const operation = useState<{ key: string, body: Record<string, unknown> } | null>(cacheKey(`project-lifecycle-intent:${props.projectId}`), () => null)
const actions = computed<LifecycleAction[]>(() => props.status === 'active' ? ['pause', 'finish'] : props.status === 'paused' ? ['resume'] : [])
const pending = computed(() => Object.values(instances.value).some(instance => instance?.status === 'running'))
const labels: Record<string, string> = { running: '审批中', approved: '已通过', rejected: '已驳回', cancelled: '已撤回' }
const allowed = (code: LifecycleAction) => props.canManage && hasPermission('projects', code === 'finish' ? 'close' : 'edit')
async function refresh() {
  reading.value = true
  readError.value = ''
  try {
    const entries = await Promise.all((['pause', 'resume', 'finish'] as const).map(async (code) => {
      const response = await $fetch<{ code: number, data: WorkflowByBizResult | null }>('/api/workflow-proxy/instances/by-biz', {
        query: { app_code: 'aims', resource_code: 'projects', action_code: code, biz_id: props.projectId, include_history: 'true' }
      })
      if (response.code !== 0) throw Error('审批状态响应无效')
      return [code, response.data] as const
    }))
    instances.value = Object.fromEntries(entries)
  } catch {
    readError.value = '审批状态暂不可用，请刷新后再发起申请。'
  } finally {
    reading.value = false
  }
}
function actionableTasks(instance: WorkflowByBizResult | null | undefined) {
  if (!instance || instance.initiator_uid === currentUid.value) return []
  return (instance.tasks || []).filter(task => task.status === 'pending' && task.assignee_uid === currentUid.value)
}
function resumeIntent() {
  if (!operation.value) return
  action.value = operation.value.body.actionCode as LifecycleAction
  comment.value = String(operation.value.body.comment || '')
  error.value = '先前审批申请结果未确认，可以按原请求继续。'
  open.value = true
}
function begin(code: LifecycleAction) {
  if (operation.value) {
    resumeIntent()
    return
  }
  action.value = code
  comment.value = ''
  error.value = ''
  operation.value = null
  open.value = true
}
async function submit() {
  if (!allowed(action.value) || !comment.value.trim()) return
  if (!operation.value) {
    if (!(await confirm({ title: projectWorkflowActionConfigs[action.value].actionLabel, message: `将为项目“${props.name}”发起${projectWorkflowActionConfigs[action.value].successLabel}。审批通过后由服务端变更项目状态；结项将标记为已完成，不会归档。`, confirmLabel: '发起申请', tone: 'warning' }))) return
    operation.value = { key: `project-${props.projectId}-${action.value}-${crypto.randomUUID()}`, body: { actionCode: action.value, comment: comment.value.trim(), expectedVersion: props.expectedVersion } }
  }
  saving.value = true
  error.value = ''
  try {
    const response = await $fetch<{ code: number }>(moduleUrl(`/api/v1/projects/${props.projectId}/lifecycle`), {
      method: 'POST', headers: { 'Idempotency-Key': operation.value.key }, body: operation.value.body
    })
    if (response.code !== 0) throw Error('审批申请响应无效')
    operation.value = null
    open.value = false
    toast.add({ title: `${projectWorkflowActionConfigs[action.value].successLabel}已发起`, color: 'success' })
    await refresh()
    emit('refresh')
  } catch (cause) {
    const failure = cause as { statusCode?: number, status?: number, data?: { requestFrozen?: boolean, data?: { requestFrozen?: boolean } } }
    const status = failure.statusCode || failure.status || 0
    error.value = status === 403 ? '你没有发起此审批的权限，或项目管理关系已变更。说明已保留。' : status === 409 ? '项目版本、状态或审批申请已变化。说明已保留，请刷新后重新确认。' : '申请结果未确认。说明已保留，重试将沿用同一请求继续创建或绑定审批。'
    // Never abandon an uncertain request: Runtime may already have frozen it.
    if (status && status < 500 && !failure.data?.requestFrozen && !failure.data?.data?.requestFrozen) operation.value = null
  } finally {
    saving.value = false
  }
}
onMounted(refresh)
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h3 class="font-semibold">
          项目生命周期审批
        </h3>
        <UButton
          label="刷新审批及项目"
          color="neutral"
          variant="outline"
          :loading="reading"
          @click="refresh(); emit('refresh')"
        />
      </div>
    </template>
    <div class="space-y-4">
      <p class="text-sm text-muted">
        暂停、恢复和结项须经过正式审批。通过后由服务端推进；结项落为已完成。成员管理仍在独立项目成员页。
      </p>
      <UAlert
        v-if="!canManage"
        color="neutral"
        title="生命周期只读"
        description="仅具备相应范围权限的当前负责人或在职项目经理可发起申请；结项另需项目关闭权限。"
      />
      <UAlert v-if="readError" color="error" :description="readError" />
      <UButton
        v-if="operation && !open"
        label="继续未确认申请"
        color="warning"
        :disabled="saving"
        @click="resumeIntent"
      />
      <div class="flex flex-wrap gap-2">
        <UButton
          v-for="code in actions"
          :key="code"
          :label="projectWorkflowActionConfigs[code].actionLabel"
          :disabled="!allowed(code) || pending || reading || !!readError"
          @click="begin(code)"
        />
      </div>
      <p v-if="pending" class="text-sm text-warning">
        已有审批进行中，请等待审批完成；刷新只读取结果，不会修改项目状态。
      </p>
      <div v-for="code in (['pause', 'resume', 'finish'] as const)" :key="code" class="text-sm">
        <div v-if="instances[code]" class="flex min-w-0 flex-wrap items-center gap-2">
          <span>{{ projectWorkflowActionConfigs[code].successLabel }}</span>
          <UBadge :color="instances[code]?.status === 'running' ? 'warning' : instances[code]?.status === 'approved' ? 'success' : 'neutral'" variant="subtle">
            {{ labels[instances[code]?.status || ''] || instances[code]?.status }}
          </UBadge>
          <span class="break-all text-muted">{{ instances[code]?.instance_no }}</span>
          <UButton
            v-for="task in actionableTasks(instances[code])"
            :key="task.id"
            :to="`/enterprise/approvals/${task.id}`"
            label="处理审批"
            color="neutral"
            variant="outline"
            size="sm"
          />
        </div>
        <UCollapsible v-if="instances[code]" class="mt-2">
          <UButton
            label="查看审批过程"
            color="neutral"
            variant="link"
            size="sm"
            trailing-icon="i-lucide-chevron-down"
          />
          <template #content>
            <WorkflowTimeline
              :nodes="instances[code]?.flow_snapshot?.nodes || []"
              :actions="instances[code]?.actions || []"
              :tasks="instances[code]?.tasks || []"
              :current-node="instances[code]?.current_node || 0"
              :status="instances[code]?.status || ''"
            />
          </template>
        </UCollapsible>
      </div>
    </div>
    <UModal v-model:open="open" :title="projectWorkflowActionConfigs[action].name" :dismissible="!saving">
      <template #body>
        <div class="space-y-4">
          <UAlert v-if="error" color="error" :description="error" />
          <UFormField :label="projectWorkflowActionConfigs[action].reasonLabel" required>
            <UTextarea
              v-model="comment"
              class="w-full"
              :maxlength="4000"
              :placeholder="projectWorkflowActionConfigs[action].reasonPlaceholder"
              :disabled="saving || !!operation"
            />
          </UFormField>
          <p class="text-sm text-muted">
            审批资格与最终状态以服务端结果为准。
          </p>
        </div>
      </template>
      <template #footer>
        <UButton
          :label="operation ? '暂时关闭' : '取消'"
          color="neutral"
          variant="outline"
          :disabled="saving"
          @click="open = false"
        />
        <UButton
          :label="operation ? '按原请求重试' : projectWorkflowActionConfigs[action].submitLabel"
          :loading="saving"
          :disabled="!comment.trim()"
          @click="submit"
        />
      </template>
    </UModal>
  </UCard>
</template>
