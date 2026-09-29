<script setup lang="ts">
import { createDebouncedRefresh } from '../../shared/debounced-refresh.mjs'

const route = useRoute()
const auth = useAuth()
const workflow = usePageWorkflowState()
const itemId = computed(() => String(route.params.workItemId || ''))
const projectId = computed(() => String(route.params.id || ''))
const instanceId = ref(0)
const itemStatus = ref('')
const editVersion = ref('')
const completionKind = ref<'target' | 'matter'>('target')
const canRequest = ref(false)
const blockedReason = ref('')
const loading = ref(false)
const submitting = ref(false)
const error = ref('')
const pending = ref(false)
const retryKeys = new Map<string, string>()

function retryKey() {
  const scope = `${String(auth.tenant.value || '')}:${String(auth.user.value || '')}:${projectId.value}:${itemId.value}:${completionKind.value}:${editVersion.value}`
  const name = `hzy:workflow-completion:${scope}`
  let key = retryKeys.get(name) || ''
  try {
    key = sessionStorage.getItem(name) || key
  } catch { /* In-memory fallback. */ }
  if (!key) key = crypto.randomUUID()
  retryKeys.set(name, key)
  try {
    sessionStorage.setItem(name, key)
  } catch { /* In-memory fallback. */ }
  return { name, key }
}

function clearRetry(name: string) {
  retryKeys.delete(name)
  try {
    sessionStorage.removeItem(name)
  } catch { /* Storage may be unavailable. */ }
}

// Fixed codes from the Runtime/Host completion hint; anything unknown keeps the
// generic text so a new code never shows a raw identifier.
const blockedReasonText: Record<string, string> = {
  matter_completion_time_required: '请先记录工时，再提交完成审批。',
  matter_completion_evidence_required: '必填成果的证据尚未补齐，补齐后再提交完成审批。',
  matter_completion_commit_required: '代码类成果需要先关联提交记录。',
  matter_completion_assignee_required: '只有事项负责人可以提交完成审批。',
  work_item_completion_state_invalid: '只有进行中的事项可以提交完成审批。',
  work_items_edit_required: '你没有编辑工作项的权限，不能提交完成审批。'
}

function message(value: unknown, fallback: string) {
  const cause = value as { data?: { message?: string }, message?: string } | null
  return cause?.data?.message || cause?.message || fallback
}

async function refresh() {
  if (!/^[1-9]\d*$/u.test(itemId.value)) return
  loading.value = true
  error.value = ''
  try {
    const [workItem, flow] = await Promise.all([
      $fetch<{ code?: number, data?: { status?: string, editVersion?: string, completion?: { kind?: string, canRequest?: boolean, reason?: string } } }>(`/aims/api/v1/work-items/${itemId.value}`),
      $fetch<{ code?: number, data?: { instance_id?: number | string } | null }>(sharedApiPath('/api/workflow-proxy/instances/by-biz'), {
        query: { app_code: 'aims', resource_code: 'tasks', action_code: 'complete', biz_id: itemId.value }
      })
    ])
    if (workItem.code !== 0 || flow.code !== 0 || !workItem.data) throw Error('审批状态读取失败')
    itemStatus.value = String(workItem.data?.status || '')
    editVersion.value = String(workItem.data?.editVersion || '')
    completionKind.value = workItem.data?.completion?.kind === 'matter' ? 'matter' : 'target'
    canRequest.value = workItem.data?.completion?.canRequest === true
    blockedReason.value = canRequest.value ? '' : blockedReasonText[String(workItem.data?.completion?.reason || '')] || ''
    const currentInstance = Number(flow.data?.instance_id || 0)
    if (!Number.isSafeInteger(currentInstance) || currentInstance < 0) throw Error('审批实例标识无效')
    instanceId.value = currentInstance
    pending.value = itemStatus.value === 'in_review' && !instanceId.value
  } catch (cause) {
    canRequest.value = false
    blockedReason.value = ''
    instanceId.value = 0
    pending.value = false
    error.value = message(cause, '审批信息加载失败')
  } finally {
    loading.value = false
  }
}

async function submitCompletion() {
  if (!canRequest.value || !/^[a-f0-9]{64}$/u.test(editVersion.value) || submitting.value) return
  submitting.value = true
  error.value = ''
  const retry = retryKey()
  try {
    await workflow.beforeSubmit()
    const path = completionKind.value === 'matter' ? 'matter-completion' : 'completion'
    await $fetch(`/aims/api/v1/work-items/${itemId.value}/${path}`, {
      method: 'POST',
      headers: { 'Idempotency-Key': retry.key },
      body: { projectId: projectId.value, expectedVersion: editVersion.value }
    })
    clearRetry(retry.name)
    await refresh()
  } catch (cause) {
    error.value = message(cause, '提交完成审批失败')
    // A conflict requires a fresh read. Never retry a write automatically.
    if ((cause as { statusCode?: number })?.statusCode === 409) await refresh()
  } finally {
    submitting.value = false
  }
}

watch([itemId, projectId], () => {
  void refresh()
}, { immediate: true })

// The page re-reads its work item after time entries, deliverables or status
// change and bumps the page-workflow revision. Re-read readiness for the same
// item only, debounced and never overlapping.
const contextRefresh = createDebouncedRefresh({ run: refresh, delay: 300 })
watch(() => workflow.bizRevision.value, () => {
  if (workflow.bizId.value && workflow.bizId.value === itemId.value) contextRefresh.schedule()
})
onScopeDispose(() => contextRefresh.dispose())
</script>

<template>
  <section
    class="min-h-0 p-3"
    aria-label="审批流程"
  >
    <div class="mb-3 flex items-center justify-between gap-2">
      <h2 class="text-sm font-semibold">
        完成确认
      </h2>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-refresh-cw"
        aria-label="刷新审批状态"
        :loading="loading"
        @click="refresh"
      />
    </div>
    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      :description="error"
      class="mb-3"
    />
    <div
      v-if="loading && !instanceId"
      class="text-sm text-muted"
      role="status"
    >
      正在读取审批状态…
    </div>
    <WorkflowPanel
      v-else-if="instanceId"
      :key="instanceId"
      :instance-id="instanceId"
      @approved="refresh"
      @rejected="refresh"
    />
    <div
      v-else-if="pending"
      class="text-sm text-muted"
      role="status"
    >
      完成申请已入队，等待本机 Workflow 生成审批实例。
    </div>
    <div
      v-else-if="canRequest && !error"
      class="space-y-3"
    >
      <p class="text-sm text-muted">
        {{ completionKind === 'matter' ? '提交后将冻结事项、工时和成果证据摘要，审批结果由服务端回写。' : '提交后将冻结工作项与子项快照，审批结果由服务端回写。' }}
      </p>
      <UButton
        color="primary"
        :loading="submitting"
        :disabled="!workflow.canSubmit.value || !editVersion"
        @click="submitCompletion"
      >
        提交完成审批
      </UButton>
      <p
        v-for="issue in workflow.completenessIssues.value"
        :key="issue"
        class="text-xs text-warning"
      >
        {{ issue }}
      </p>
    </div>
    <p
      v-else-if="!error && blockedReason"
      class="text-sm text-warning"
      role="status"
    >
      {{ blockedReason }}
    </p>
    <p
      v-else-if="!error"
      class="text-sm text-muted"
    >
      当前工作项没有可提交的完成申请。审批状态以服务端记录为准。
    </p>
  </section>
</template>
