<script setup lang="ts">
const props = defineProps<{
  productCode: string
  version: { id: number, product_code: string, version_code: string, status: string, revision: number, workspace_revision: number, current_release_record_id: number | null }
  canEdit: boolean
  disabled?: boolean
}>()
const emit = defineEmits<{ busy: [boolean], saved: [] }>()
const open = ref(false), saving = ref(false), reason = ref('')
const snapshot = ref<{ workspace: number, version: number, name: string } | null>(null)
const error = ref<Error | null>(null)
const alert = useApiErrorAlert(error, { fallbackTitle: '进入开发失败' })
const canTransition = computed(() => props.canEdit && props.version.product_code === props.productCode && props.version.status === 'planning' && !props.version.current_release_record_id && [props.version.id, props.version.revision, props.version.workspace_revision].every(n => Number.isSafeInteger(n) && n > 0))
const { confirm } = useConfirm()
const toast = useToast()
let retry: { payload: string, key: string } | undefined
function start() {
  if (!canTransition.value || props.disabled || saving.value) return
  snapshot.value = { workspace: props.version.workspace_revision, version: props.version.revision, name: props.version.version_code }
  reason.value = ''
  error.value = null
  retry = undefined
  open.value = true
}
async function save() {
  if (!canTransition.value || !snapshot.value || !reason.value.trim() || saving.value || props.disabled) return
  const selected = snapshot.value
  const body = { expectedRevision: selected.workspace, expectedVersionRevision: selected.version, toStatus: 'developing', reason: reason.value }
  const payload = JSON.stringify(body)
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  saving.value = true
  emit('busy', true)
  error.value = null
  let completed = false
  try {
    if (!await confirm({ title: '版本进入开发', message: `版本：${selected.name}\n原因：${body.reason}\n版本将从规划中进入开发中，后续仍需完成范围交付、整体验收和发布。`, confirmLabel: '进入开发' })) return
    const response = await $fetch<{ code: number, data: { value: { version_id: number, product_code: string, status: string } } }>(`/api/v1/products/${encodeURIComponent(props.productCode)}/versions/${props.version.id}/transition`, { method: 'POST', body, headers: { 'Idempotency-Key': retry.key } })
    const result = response.data?.value
    if (response.code !== 0 || result?.version_id !== props.version.id || result.product_code !== props.productCode || result.status !== 'developing') throw new Error('状态结果不完整，请使用原请求重试')
    completed = true
    open.value = false
    retry = undefined
    toast.add({ title: '版本已进入开发', color: 'success' })
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('进入开发失败')
  } finally {
    saving.value = false
    emit('busy', false)
  }
  if (completed) emit('saved')
}
</script>

<template>
  <UButton v-if="canTransition" :disabled="disabled || saving" @click="start">
    进入开发
  </UButton>
  <UModal
    v-model:open="open"
    title="版本进入开发"
    description="系统会校验计划确认和当前版本修订，记录本次决定。"
    :dismissible="!saving"
    :close="!saving"
  >
    <template #body>
      <form class="space-y-4" @submit.prevent="save">
        <UAlert v-if="alert" v-bind="alert" />
        <p class="break-words">
          {{ snapshot?.name }} · 规划中 → 开发中
        </p>
        <UFormField label="进入开发原因" required>
          <UTextarea
            v-model="reason"
            required
            :maxlength="2000"
            :disabled="saving"
            class="w-full"
          />
        </UFormField>
        <p v-if="error" class="text-sm text-muted">
          原因已保留。若版本已变化，请复制原因、关闭窗口并重新读取后操作。
        </p>
        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="saving"
            @click="open = false"
          >
            取消
          </UButton>
          <UButton type="submit" :loading="saving" :disabled="!canTransition || !reason.trim()">
            确认进入开发
          </UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>
