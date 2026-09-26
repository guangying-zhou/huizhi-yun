<script setup lang="ts">
import { useAimsModule } from '../../../layer/useAimsModule'

const props = defineProps<{ productCode: string, versionId: string, scopeId: number, title: string, criteria: string | null, workspaceRevision: number, versionRevision: number, scopeRevision: number }>()
const { moduleUrl } = useAimsModule()
const emit = defineEmits<{ saved: [], cancel: [], busy: [boolean] }>()
const criteria = ref(props.criteria || ''), reason = ref(''), saving = ref(false)
const error = ref<Error | null>(null)
const alert = useApiErrorAlert(error, { fallbackTitle: '历史范围标准保存失败' })
const { confirm } = useConfirm()
let retry: { payload: string, key: string } | undefined
async function save() {
  if (saving.value || !criteria.value.trim() || !reason.value.trim()) return
  const body = { expectedRevision: props.workspaceRevision, expectedVersionRevision: props.versionRevision, expectedScopeRevision: props.scopeRevision, acceptanceCriteria: criteria.value, reason: reason.value }
  const payload = JSON.stringify(body)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  saving.value = true
  emit('busy', true)
  error.value = null
  let completed = false
  try {
    if (!await confirm({ title: '补录历史范围验收标准', message: `范围：${props.title}\n原标准：${props.criteria || '未填写'}\n新标准：${body.acceptanceCriteria}\n原因：${body.reason}\n历史未评估属性保留，范围版本更新后需要重新核验验收依据。`, confirmLabel: '保存标准', tone: 'warning' })) return
    const result = await $fetch<{ code: number, data: { value: { id: number, version_id: number, product_code: string, acceptance_criteria: string } } }>(moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/versions/${encodeURIComponent(props.versionId)}/features/${props.scopeId}/legacy-criteria`), { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
    const value = result.data?.value
    if (result.code !== 0 || value?.id !== props.scopeId || String(value.version_id) !== props.versionId || value.product_code !== props.productCode || value.acceptance_criteria !== body.acceptanceCriteria) throw new Error('保存结果不完整，请使用原请求重试')
    completed = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('保存失败')
  } finally {
    saving.value = false
    emit('busy', false)
  }
  if (completed) emit('saved')
}
onBeforeRouteLeave(() => !saving.value)
onBeforeRouteUpdate(() => !saving.value)
</script>

<template>
  <form class="space-y-4" @submit.prevent="save">
    <p class="break-words">
      {{ title }} · 历史未评估范围
    </p>
    <UAlert v-if="alert" v-bind="alert" />
    <UFormField label="验收标准" required>
      <UTextarea
        v-model="criteria"
        required
        :maxlength="10000"
        :disabled="saving"
        class="w-full"
      />
    </UFormField>
    <UFormField label="补录原因" required>
      <UTextarea
        v-model="reason"
        required
        :maxlength="2000"
        :disabled="saving"
        class="w-full"
      />
    </UFormField>
    <p v-if="error" class="text-sm text-muted">
      输入已保留。如版本已变化，请复制输入、关闭并重新读取范围后操作。
    </p>
    <div class="flex flex-wrap gap-2">
      <UButton type="submit" :loading="saving" :disabled="!criteria.trim() || !reason.trim()">
        保存标准
      </UButton>
      <UButton
        color="neutral"
        variant="ghost"
        :disabled="saving"
        @click="emit('cancel')"
      >
        取消
      </UButton>
    </div>
  </form>
</template>
