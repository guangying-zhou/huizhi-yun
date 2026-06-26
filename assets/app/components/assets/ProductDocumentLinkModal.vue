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
  set: value => emit('update:open', value)
})

const toast = useToast()
const submitting = ref(false)
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
    state.document_id = ''
    state.document_type = 'other'
    state.remark = ''
  }
})

async function handleSubmit() {
  if (!props.product?.id) {
    return
  }

  if (!state.document_id.trim()) {
    toast.add({ title: '缺少文档编号', description: '请填写 Codocs 文档编号。', color: 'warning' })
    return
  }

  submitting.value = true

  try {
    await $fetch<ApiResponse<{ id: number }>>(`/api/v1/products/${props.product.id}/documents`, {
      method: 'POST',
      body: {
        document_id: state.document_id.trim(),
        document_type: state.document_type,
        remark: state.remark.trim() || null
      }
    })

    toast.add({ title: '文档已关联', description: '产品文档关联已保存。', color: 'success', icon: 'i-lucide-check' })
    emit('created')
    isOpen.value = false
  } catch (error) {
    console.error('[ProductDocumentLink] Failed:', error)
    toast.add({ title: '关联失败', description: '请检查文档编号后重试。', color: 'error', icon: 'i-lucide-circle-alert' })
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
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <UFormField label="文档编号" required>
          <UInput
            v-model="state.document_id"
            placeholder="例如：DOC-PROD-ALIGN-001"
            class="w-full"
          />
        </UFormField>

        <UFormField label="文档类型">
          <USelect
            v-model="state.document_type"
            :items="documentTypeOptions"
            class="w-full"
          />
        </UFormField>

        <UFormField label="备注">
          <UTextarea
            v-model="state.remark"
            :rows="3"
            placeholder="补充文档用途或交付背景"
            class="w-full"
          />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-3">
        <UButton color="neutral" variant="outline" @click="isOpen = false">
          取消
        </UButton>
        <UButton :loading="submitting" icon="i-lucide-link" @click="handleSubmit">
          确认关联
        </UButton>
      </div>
    </template>
  </UModal>
</template>
