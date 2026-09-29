<script setup lang="ts">
import { useAimsModule } from '../../../layer/useAimsModule'

const { moduleUrl } = useAimsModule()
const props = defineProps<{ productCode: string, workspaceRevision: number, request: { biz_id: string, revision: number, title: string } }>()
const emit = defineEmits<{ saved: [], cancel: [] }>()
const note = ref(''), evidenceDate = ref('')
const kind = ref('assumption'), direction = ref('neutral')
const busy = ref(false)
const error = ref<Error | null>(null)
const alert = useApiErrorAlert(error, { fallbackTitle: '证据保存失败' })
const expectedRevision = props.workspaceRevision, expectedRequestRevision = props.request.revision
let retry: { payload: string, key: string } | undefined
async function save() {
  if (busy.value) return
  error.value = null
  if (!note.value.trim()) {
    error.value = new Error('请填写来源说明')
    return
  }
  const body = { expectedRevision, expectedRequestRevision, note: note.value, evidenceDate: evidenceDate.value || null, kind: kind.value, direction: direction.value }
  const payload = JSON.stringify(body)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  busy.value = true
  try {
    const response = await $fetch<{ code: number }>(moduleUrl(`/api/v1/products/${encodeURIComponent(props.productCode)}/requests/${props.request.biz_id}/sources`), { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
    if (response.code !== 0) throw new Error('证据保存结果不完整，请重试')
    emit('saved')
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('证据保存失败')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="space-y-4" @submit.prevent="save">
    <p class="break-words font-medium">
      {{ request.title }}
    </p>
    <p class="text-sm text-muted">
      人工说明固定为“未验证”。事实／假设表示记录类别，选择事实不会将引用标成已验证。日期不清楚时可留空。
    </p>
    <UAlert v-if="alert" v-bind="alert" />
    <UFormField label="来源说明" name="sourceNote" required>
      <UTextarea
        v-model="note"
        :disabled="busy"
        required
        :maxlength="10000"
        :rows="5"
        class="w-full"
        placeholder="原话、观察或判断依据；可同时记录相反意见"
      />
    </UFormField>
    <UFormField label="证据日期" name="evidenceDate">
      <UInput
        v-model="evidenceDate"
        type="date"
        min="1000-01-01"
        max="9999-12-31"
        :disabled="busy"
        class="w-full"
      />
    </UFormField>
    <div class="grid gap-4 sm:grid-cols-2">
      <UFormField label="证据类别" name="evidenceKind" required>
        <USelect
          v-model="kind"
          :disabled="busy"
          :items="[{ label: '假设', value: 'assumption' }, { label: '事实', value: 'fact' }]"
          class="w-full"
        />
      </UFormField>
      <UFormField label="证据方向" name="evidenceDirection" required>
        <USelect
          v-model="direction"
          :disabled="busy"
          :items="[{ label: '中立', value: 'neutral' }, { label: '支持', value: 'supporting' }, { label: '反对', value: 'opposing' }]"
          class="w-full"
        />
      </UFormField>
    </div>
    <div class="flex flex-wrap gap-3">
      <UButton type="submit" :loading="busy">
        保存证据
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
