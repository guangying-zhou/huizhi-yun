<script setup lang="ts">
import type { ApiResponse, ProductAssetItem } from '~/types'

const props = defineProps<{
  open: boolean
  product: ProductAssetItem | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'created': []
}>()

const isOpen = computed({
  get: () => props.open,
  set: (value) => {
    if (!submitting.value) emit('update:open', value)
  }
})

const toast = useToast()
const submitting = ref(false)
const submitError = ref('')
const documentTypeOptions = [
  { label: '需求文档', value: 'requirement' },
  { label: '设计文档', value: 'design' },
  { label: '接口文档', value: 'api' },
  { label: '运维文档', value: 'ops' },
  { label: '交付文档', value: 'delivery' },
  { label: '附件', value: 'attachment' },
  { label: '其他', value: 'other' }
]

const state = reactive({
  document_id: '',
  document_type: 'other',
  remark: ''
})

watch(() => props.open, (open) => {
  if (open) {
    submitError.value = ''
    state.document_id = ''
    state.document_type = 'other'
    state.remark = ''
  }
})

async function handleSubmit() {
  if (submitting.value || !props.product?.id) {
    return
  }

  const documentUuid = state.document_id.trim()
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(documentUuid) || documentUuid === '00000000-0000-0000-0000-000000000000') {
    submitError.value = '请填写完整、有效的 Codocs 文档 UUID。'
    return
  }

  submitting.value = true
  submitError.value = ''
  const productId = props.product.id

  try {
    const response = await $fetch<ApiResponse<{ id: number }>>(`/api/v1/products/${productId}/documents`, {
      method: 'POST',
      body: {
        document_id: documentUuid,
        document_type: state.document_type,
        remark: state.remark.trim() || null
      }
    })

    if (response.code !== 0 || Number(response.data?.id) !== Number(productId)) throw new Error('关联结果不完整')
    toast.add({ title: '文档已关联', description: '产品文档关联已保存。', color: 'success', icon: 'i-lucide-check' })
    emit('created')
    emit('update:open', false)
  } catch (error) {
    console.error('[ProductDocumentLink] Failed:', error)
    submitError.value = '关联未完成。请确认你可访问该产品和文档后重试；输入内容已保留。'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    title="关联产品文档"
    description="将 Codocs 文档挂到当前产品，沉淀需求、设计和交付文档。"
    :dismissible="!submitting"
    :close="!submitting"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <UAlert v-if="submitError" color="error" :description="submitError" />
        <UFormField label="文档 UUID" required>
          <UInput
            v-model="state.document_id"
            :disabled="submitting"
            placeholder="填写 Codocs 文档的完整 UUID"
            class="w-full"
          />
        </UFormField>

        <UFormField label="文档类型">
          <USelect
            v-model="state.document_type"
            :disabled="submitting"
            :items="documentTypeOptions"
            class="w-full"
          />
        </UFormField>

        <UFormField label="备注">
          <UTextarea
            v-model="state.remark"
            :disabled="submitting"
            :rows="3"
            placeholder="补充文档用途或交付背景"
            class="w-full"
          />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-3">
        <UButton
          color="neutral"
          variant="outline"
          :disabled="submitting"
          @click="isOpen = false"
        >
          取消
        </UButton>
        <UButton :loading="submitting" icon="i-lucide-link" @click="handleSubmit">
          确认关联
        </UButton>
      </div>
    </template>
  </UModal>
</template>
