<script setup lang="ts">
type Detail = { task: { id: number, status: string, node_name: string, created_at: string }, instance: { id: number, instance_no: string, action_name: string, biz_title: string, initiator_uid: string, created_at: string, form_data?: Record<string, unknown> }, capabilities: { can_approve: boolean, can_reject: boolean } }
const route = useRoute()
const id = computed(() => String(route.params.id || ''))
const auth = useAuth()
const verifiedScope = useState<string>('enterprise-verified-scope', () => '')
const comment = ref('')
const busy = ref(false)
const decisionError = ref('')
const { confirm } = useConfirm()
const { data, status, error, refresh } = await useFetch<{ code: number, data: Detail }>(() => `/api/workflow-proxy/tasks/${id.value}`, { server: false })
const detail = computed(() => data.value?.code === 0 ? data.value.data : null)
const matterSnapshot = computed(() => {
  const form = detail.value?.instance.form_data
  if (form?.kind !== 'matter' || !/^[a-f0-9]{64}$/u.test(String(form.snapshotSha256 || ''))) return null
  const summary = form.evidenceSummary
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null
  const values = summary as Record<string, unknown>
  const count = (name: string) => Number(values[name])
  if (['deliverableCount', 'requiredDeliverableCount', 'commitCount', 'timeEntryCount'].some(name => !Number.isSafeInteger(count(name)) || count(name) < 0)) return null
  return { workItemId: String(form.workItemId || ''), hash: String(form.snapshotSha256), deliverables: count('deliverableCount'), required: count('requiredDeliverableCount'), commits: count('commitCount'), timeEntries: count('timeEntryCount') }
})
const matterSnapshotInvalid = computed(() => detail.value?.instance.form_data?.kind === 'matter' && !matterSnapshot.value)
const retryKeys = new Map<string, string>()

function decisionKey(action: 'approve' | 'reject') {
  const scope = verifiedScope.value || `${String(auth.tenant.value || '')}:${String(auth.user.value || '')}`
  const name = `hzy:host-approval:${scope}:${id.value}:${action}`
  let key = retryKeys.get(name) || ''
  try {
    key = sessionStorage.getItem(name) || key
  } catch { /* Keep the in-memory key. */ }
  if (!key) key = crypto.randomUUID()
  retryKeys.set(name, key)
  try {
    sessionStorage.setItem(name, key)
  } catch { /* Keep the in-memory key. */ }
  return { name, key }
}

function clearKey(name: string) {
  retryKeys.delete(name)
  try {
    sessionStorage.removeItem(name)
  } catch { /* Storage may be unavailable. */ }
}

async function decide(action: 'approve' | 'reject') {
  if (!detail.value || busy.value || (action === 'approve' ? !detail.value.capabilities.can_approve : !detail.value.capabilities.can_reject)) return
  if (action === 'reject' && !comment.value.trim()) {
    decisionError.value = '请填写驳回原因'
    return
  }
  if (!await confirm({ title: action === 'approve' ? '同意审批' : '驳回审批', message: `确认处理“${detail.value.instance.biz_title || '审批事项'}”？`, confirmLabel: action === 'approve' ? '同意' : '驳回', tone: action === 'reject' ? 'warning' : undefined })) return
  busy.value = true
  decisionError.value = ''
  const retry = decisionKey(action)
  try {
    await $fetch(`/api/workflow-proxy/tasks/${id.value}/${action}`, { method: 'POST', headers: { 'Idempotency-Key': retry.key }, body: { comment: comment.value.trim() } })
    clearKey(retry.name)
    await navigateTo('/enterprise/approvals')
  } catch (cause) {
    const failure = cause as { statusCode?: number, data?: { message?: string }, message?: string }
    decisionError.value = failure.data?.message || failure.message || '审批操作失败，请使用原请求重试'
    if (failure.statusCode === 409) await refresh()
  } finally { busy.value = false }
}
</script>

<template>
  <section class="mx-auto max-w-3xl space-y-5 p-4 sm:p-6">
    <UButton
      to="/enterprise/approvals"
      color="neutral"
      variant="link"
      icon="i-lucide-arrow-left"
    >
      返回待办
    </UButton>
    <h1 class="text-2xl font-semibold">
      审批任务
    </h1>
    <UAlert
      v-if="error || (data && data.code !== 0)"
      color="error"
      title="任务不可用"
      description="任务可能已处理，或你没有查看资格。"
    />
    <USkeleton
      v-else-if="status === 'pending'"
      class="h-48 w-full"
    />
    <template v-else-if="detail">
      <UCard>
        <h2 class="text-lg font-medium">
          {{ detail.instance.biz_title || '审批事项' }}
        </h2>
        <dl class="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt class="text-muted">
              动作
            </dt><dd>{{ detail.instance.action_name || '完成确认' }}</dd>
          </div>
          <div>
            <dt class="text-muted">
              审批节点
            </dt><dd>{{ detail.task.node_name || '审批' }}</dd>
          </div>
          <div>
            <dt class="text-muted">
              流程编号
            </dt><dd>{{ detail.instance.instance_no }}</dd>
          </div>
          <div>
            <dt class="text-muted">
              提交人
            </dt><dd>{{ detail.instance.initiator_uid }}</dd>
          </div>
        </dl>
        <p class="mt-4 text-xs text-muted">
          以上内容来自 Workflow 提交时保存的快照。
        </p>
        <div
          v-if="matterSnapshot"
          class="mt-4 rounded-lg border border-default bg-muted/30 p-3 text-sm"
          aria-label="事项提交快照"
        >
          <UBadge
            color="info"
            variant="soft"
          >
            事项完成
          </UBadge>
          <p class="mt-2">
            工作项 {{ matterSnapshot.workItemId }} · 成果 {{ matterSnapshot.deliverables }} 项（必需 {{ matterSnapshot.required }} 项）
          </p>
          <p>代码提交 {{ matterSnapshot.commits }} 条 · 工时记录 {{ matterSnapshot.timeEntries }} 条</p>
          <p class="mt-1 break-all text-xs text-muted">
            冻结摘要 SHA-256：{{ matterSnapshot.hash }}
          </p>
        </div>
      </UCard>
      <UAlert
        v-if="decisionError"
        color="error"
        :description="decisionError"
      />
      <UAlert
        v-if="matterSnapshotInvalid"
        color="error"
        description="事项审批快照无效，请联系管理员。"
      />
      <UTextarea
        v-model="comment"
        aria-label="审批意见"
        placeholder="审批意见；驳回时必填"
        class="w-full"
      />
      <div class="flex flex-wrap gap-3">
        <UButton
          v-if="detail.capabilities.can_approve && !matterSnapshotInvalid"
          :loading="busy"
          @click="decide('approve')"
        >
          同意
        </UButton>
        <UButton
          v-if="detail.capabilities.can_reject && !matterSnapshotInvalid"
          color="error"
          variant="soft"
          :loading="busy"
          @click="decide('reject')"
        >
          驳回
        </UButton>
      </div>
    </template>
  </section>
</template>
