<script setup lang="ts">
import { useAimsModule } from '../../../layer/useAimsModule'

const { moduleUrl } = useAimsModule()
const props = defineProps<{ productCode: string, workspaceRevision: number, request: { biz_id: string, title: string, revision: number, decision_status: string } }>()
const emit = defineEmits<{ saved: [], cancel: [] }>()
const labels: Record<string, string> = { evaluating: '进入评估', accepted: '采纳', deferred: '暂缓', rejected: '拒绝' }
const transitions: Record<string, string[]> = { submitted: ['evaluating'], evaluating: ['accepted', 'deferred', 'rejected'], deferred: ['evaluating'], accepted: ['evaluating', 'rejected'] }
const options = (transitions[props.request.decision_status] || []).map(value => ({ value, label: labels[value] || value }))
const target = ref(options[0]?.value || '')
const reason = ref(''), impactNote = ref('')
const busy = ref(false)
const error = ref<Error | null>(null)
const alert = useApiErrorAlert(error, { fallbackTitle: '需求评审失败' })
const expectedRevision = props.workspaceRevision, expectedRequestRevision = props.request.revision
const needsReason = props.request.decision_status !== 'submitted'
const needsImpact = props.request.decision_status === 'accepted'
const { confirm } = useConfirm()
let retry: { payload: string, key: string } | undefined
async function submit() {
  if (busy.value) return
  error.value = null
  if (!options.some(option => option.value === target.value) || (needsReason && !reason.value.trim()) || (needsImpact && !impactNote.value.trim())) {
    error.value = new Error('请选择允许的决定，并补充原因及必要的影响说明')
    return
  }
  const body = { expectedRevision, expectedRequestRevision, status: target.value, reason: reason.value, impactNote: impactNote.value }
  busy.value = true
  try {
    if (!(await confirm({ title: '确认产品需求决定', message: `${props.request.title}\n决定：${labels[target.value]}\n原因：${reason.value || '首次进入评估'}${needsImpact ? `\n影响：${impactNote.value}` : ''}`, tone: target.value === 'rejected' || needsImpact ? 'warning' : 'default', confirmLabel: '确认决定' }))) return
    const payload = JSON.stringify(body)
    if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
    const response = await $fetch<{ code: number }>(moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/requests/${props.request.biz_id}/decision`), { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
    if (response.code !== 0) throw new Error('评审结果不完整，请重试')
    emit('saved')
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('需求评审失败')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="submit">
    <p class="break-words font-medium">
      {{ request.title }}
    </p>
    <p class="text-sm text-muted">
      采纳后仍需完成优先级评估与交付安排。撤回采纳会保留原项目工作和版本范围，需另行协调影响。
    </p>
    <UAlert v-if="alert" v-bind="alert" />
    <UFormField label="评审决定" name="requestDecision" required>
      <USelect
        v-model="target"
        :items="options"
        :disabled="busy"
        class="w-full"
      />
    </UFormField>
    <UFormField label="决定原因" name="decisionReason" :required="needsReason">
      <UTextarea
        v-model="reason"
        :required="needsReason"
        :maxlength="2000"
        :disabled="busy"
        :rows="3"
        class="w-full"
      />
    </UFormField>
    <UFormField
      v-if="needsImpact"
      label="影响说明"
      name="decisionImpact"
      required
    >
      <UTextarea
        v-model="impactNote"
        required
        :maxlength="2000"
        :disabled="busy"
        :rows="3"
        placeholder="对已规划或执行工作的影响，以及后续处理安排"
        class="w-full"
      />
    </UFormField>
    <div class="flex flex-wrap gap-3">
      <UButton type="submit" :loading="busy" :disabled="options.length === 0">
        提交评审
      </UButton>
      <UButton
        type="button"
        color="neutral"
        variant="ghost"
        :disabled="busy"
        @click="emit('cancel')"
      >
        取消
      </UButton>
    </div>
  </form>
</template>
