<script setup lang="ts">
const props = defineProps<{ productCode: string, bizId: string, title: string, purpose: string, revision: number, workspaceRevision: number, disabled?: boolean }>()
const emit = defineEmits<{ saved: [], busy: [value: boolean] }>()
const open = ref(false), busy = ref(false), selected = ref(props.purpose)
const error = ref<unknown>(null)
const alert = useApiErrorAlert(error, { fallbackTitle: '文档用途保存失败' })
const choices = [{ label: '产品概述', value: 'product-overview' }, { label: '需求说明', value: 'requirements' }, { label: '设计文档', value: 'design' }, { label: '发布说明', value: 'release-notes' }, { label: '使用指南', value: 'user-guide' }, { label: '其他', value: 'other' }]
const modal = computed({ get: () => open.value, set: (value) => {
  if (!busy.value) open.value = value
} })
let retry: { payload: string, key: string } | undefined
watch(busy, value => emit('busy', value), { flush: 'sync' })
function start() {
  if (props.disabled || busy.value) return
  selected.value = props.purpose
  error.value = null
  open.value = true
}
async function save() {
  if (busy.value || selected.value === props.purpose) return
  const product = props.productCode
  const body = { bizId: props.bizId, expectedRevision: props.workspaceRevision, expectedDocumentRevision: props.revision, purpose: selected.value }
  const payload = JSON.stringify({ product, body })
  if (retry?.payload !== payload) retry = { payload, key: crypto.randomUUID() }
  busy.value = true
  error.value = null
  try {
    const response = await $fetch<{ code: number, data: { value: { biz_id: string, product_code: string, purpose: string } } }, string>(`/api/v1/products/${encodeURIComponent(product)}/roadmaps/documents/purpose`, { method: 'POST', headers: { 'Idempotency-Key': retry.key }, body, retry: 0, timeout: 20000 })
    const value = response.data?.value
    if (response.code !== 0 || value?.biz_id !== body.bizId || value.product_code !== product || value.purpose !== body.purpose) throw new Error('用途保存响应无效，请重试')
    retry = undefined
    open.value = false
    emit('saved')
  } catch (cause) {
    error.value = cause
  } finally { busy.value = false }
}
</script>

<template>
  <UButton
    color="neutral"
    variant="ghost"
    :disabled="disabled || busy"
    @click="start"
  >
    修改用途
  </UButton>
  <UModal
    v-model:open="modal"
    title="修改文档用途"
    :description="title"
    :dismissible="!busy"
  >
    <template #body>
      <div class="space-y-4">
        <p class="break-words text-sm">
          {{ title }}
        </p>
        <UFormField label="文档用途">
          <USelect
            v-model="selected"
            :items="choices"
            :disabled="busy"
            class="w-full"
          />
        </UFormField>
        <UAlert v-if="alert" v-bind="alert" />
        <p v-if="error" class="text-sm text-muted">
          输入已保留。若修订冲突，请关闭后刷新文档列表，再重新修改。
        </p>
      </div>
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="outline"
          :disabled="busy"
          @click="modal = false"
        >
          取消
        </UButton>
        <UButton :loading="busy" :disabled="selected === purpose" @click="save">
          保存用途
        </UButton>
      </div>
    </template>
  </UModal>
</template>
