<script setup lang="ts">
const props = defineProps<{
  productCode: string
  revision: number
  status: 'active' | 'archived'
  canArchive: boolean
  canRestore: boolean
}>()
const emit = defineEmits<{ changed: [] }>()
const action = ref<'archive' | 'restore' | null>(null)
const reason = ref('')
const expectedRevision = ref(0)
const busy = ref(false)
const error = ref<Error | null>(null)
const alert = useApiErrorAlert(error, { fallbackTitle: '产品空间状态更新失败' })
const { confirm } = useConfirm()
const toast = useToast()
let retry: { payload: string, key: string } | undefined
function begin(next: 'archive' | 'restore') {
  action.value = next
  expectedRevision.value = props.revision
  reason.value = ''
  error.value = null
  retry = undefined
}
async function submit() {
  if (!action.value || busy.value || !reason.value.trim()) return
  const selected = action.value
  const code = props.productCode
  const body = { expectedRevision: expectedRevision.value, reason: reason.value.trim() }
  busy.value = true
  error.value = null
  try {
    const accepted = await confirm({
      title: selected === 'archive' ? '归档产品空间' : '恢复产品空间',
      message: `${code}\n${selected === 'archive' ? '归档后空间仍可读取，定位信息不能继续编辑。' : '恢复后空间重新进入使用中状态。'}\n原因：${body.reason}`,
      confirmLabel: selected === 'archive' ? '确认归档' : '确认恢复',
      tone: selected === 'archive' ? 'warning' : 'default'
    })
    if (!accepted) return
    const payload = JSON.stringify({ code, selected, body })
    if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
    const response = await $fetch<{ code: number }>(`/api/v1/products/${encodeURIComponent(code)}/${selected}`, {
      method: 'POST', body, headers: { 'Idempotency-Key': retry.key }
    })
    if (response.code !== 0) throw new Error('操作结果不完整，请重试')
    action.value = null
    retry = undefined
    toast.add({ title: selected === 'archive' ? '产品空间已归档' : '产品空间已恢复', color: 'success' })
    emit('changed')
  } catch (cause) {
    error.value = cause instanceof Error ? cause : new Error('操作失败，请重试')
  } finally {
    busy.value = false
  }
}
watch(() => props.productCode, () => {
  action.value = null
  error.value = null
  retry = undefined
})
</script>

<template>
  <div class="space-y-3">
    <template v-if="!action">
      <UButton
        v-if="status === 'active' && canArchive"
        color="warning"
        variant="outline"
        icon="i-lucide-archive"
        @click="begin('archive')"
      >
        归档产品空间
      </UButton>
      <UButton
        v-if="status === 'archived' && canRestore"
        color="neutral"
        variant="outline"
        icon="i-lucide-archive-restore"
        @click="begin('restore')"
      >
        恢复产品空间
      </UButton>
    </template>
    <form v-else class="space-y-3 rounded-lg border border-default p-4" @submit.prevent="submit">
      <UAlert v-if="alert" v-bind="alert" />
      <p class="text-sm text-muted">
        状态变更只影响 Aims 产品空间，Assets 产品主档生命周期另行管理。发生版本冲突时，请刷新后重新发起操作。
      </p>
      <UFormField :label="action === 'archive' ? '归档原因' : '恢复原因'" name="reason" required>
        <UTextarea
          v-model="reason"
          :disabled="busy"
          :maxlength="2000"
          :rows="3"
          required
          class="w-full"
        />
      </UFormField>
      <div class="flex gap-2">
        <UButton type="submit" :loading="busy" :disabled="!reason.trim()">
          继续
        </UButton>
        <UButton
          color="neutral"
          variant="ghost"
          :disabled="busy"
          @click="action = null"
        >
          取消
        </UButton>
      </div>
    </form>
  </div>
</template>
