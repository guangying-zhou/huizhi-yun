<script setup lang="ts">
const props = defineProps<{ productCode: string, versionId: string, scopeId: number, isPublic: boolean, workspaceRevision: number, versionRevision: number, scopeRevision: number, disabled?: boolean }>()
const emit = defineEmits<{ saved: [], busy: [value: boolean] }>()
const open = ref(false), busy = ref(false), reason = ref(''), error = ref('')
let retry: { body: string, key: string } | undefined
const { confirm } = useConfirm()
async function save() {
  if (busy.value || props.disabled || !reason.value.trim()) return
  busy.value = true
  emit('busy', true)
  const body = JSON.stringify({ isPublic: !props.isPublic, expectedRevision: props.workspaceRevision, expectedVersionRevision: props.versionRevision, expectedScopeRevision: props.scopeRevision, reason: reason.value })
  const expected = JSON.parse(body)
  const scopeID = props.scopeId, versionID = Number(props.versionId)
  const url = `/api/v1/products/${encodeURIComponent(props.productCode)}/versions/${encodeURIComponent(props.versionId)}/features/${props.scopeId}/visibility`
  let succeeded = false
  try {
    if (!await confirm({ title: props.isPublic ? '设为内部范围' : '公开版本范围', message: '公开设置会更新产品台账和关联反馈中的版本信息。确认保存？' })) return
    error.value = ''
    if (!retry || retry.body !== body) retry = { body, key: crypto.randomUUID() }
    const response = await $fetch<{ code: number, data: { value: { id: number, version_id: number, is_public: boolean, workspace_revision: number, revision: number, scope_revision: number } } }, string>(url, { method: 'POST', body: expected, headers: { 'Idempotency-Key': retry.key } })
    const result = response?.data?.value
    if (response?.code !== 0 || result?.id !== scopeID || result.version_id !== versionID || result.is_public !== expected.isPublic || result.workspace_revision !== expected.expectedRevision + 1 || result.revision !== expected.expectedVersionRevision + 1 || result.scope_revision !== expected.expectedScopeRevision + 1) throw new Error('公开设置回执不完整')
    open.value = false
    retry = undefined
    succeeded = true
  } catch {
    error.value = '未能确认保存结果。可使用相同内容重试；如版本已变化，请关闭后刷新列表。'
  } finally {
    busy.value = false
    emit('busy', false)
  }
  if (succeeded) emit('saved')
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="修改公开设置"
    description="记录本次变更原因。"
    :dismissible="!busy"
    :close="!busy"
  >
    <UButton
      color="neutral"
      variant="outline"
      size="sm"
      :disabled="disabled || busy"
    >
      {{ isPublic ? '设为内部' : '设为公开' }}
    </UButton>
    <template #body>
      <div class="space-y-3">
        <p class="text-sm">
          {{ isPublic ? '将从公开版本摘要和反馈进度中移除此范围。' : '将在公开版本摘要和反馈进度中包含此范围。' }}
        </p>
        <UAlert v-if="error" color="error" :description="error" />
        <UFormField label="变更原因" required>
          <UTextarea
            v-model="reason"
            :disabled="busy"
            :maxlength="2000"
            class="w-full"
          />
        </UFormField>
      </div>
    </template>
    <template #footer>
      <UButton :loading="busy" :disabled="disabled || !reason.trim()" @click="save">
        保存公开设置
      </UButton>
    </template>
  </UModal>
</template>
