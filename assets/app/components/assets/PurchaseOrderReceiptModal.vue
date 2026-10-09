<script setup lang="ts">
import type { ApiResponse } from '~/types'

const props = defineProps<{
  open: boolean
  orderId: number | null
  orderNo?: string | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'created': []
}>()

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const { loadDictionaries, getOptions } = useAssetDictionaries()
await loadDictionaries()

const toast = useToast()
const submitting = ref(false)
const receiptTypeOptions = computed(() => getOptions('receipt_type'))
const receiptStatusOptions = computed(() => getOptions('receipt_status'))

const state = reactive({
  receipt_type: 'resource_activation',
  status: 'draft',
  processed_at: '',
  note: ''
})

watch(() => props.open, (open) => {
  if (open) {
    state.receipt_type = 'resource_activation'
    state.status = 'draft'
    state.processed_at = ''
    state.note = ''
  }
})

async function handleSubmit() {
  if (!props.orderId) {
    return
  }

  submitting.value = true

  try {
    await $fetch<ApiResponse<{ receipt_id: number }>>(`/api/v1/purchase-orders/${props.orderId}/receipts`, {
      method: 'POST',
      body: {
        receipt_type: state.receipt_type.trim() || 'resource_activation',
        status: state.status.trim() || 'draft',
        processed_at: state.processed_at || null,
        note: state.note.trim() || null
      }
    })

    toast.add({
      title: '入库/激活记录已创建',
      description: props.orderNo ? `${props.orderNo} 已新增处理记录。` : '已新增处理记录。',
      color: 'success',
      icon: 'i-lucide-check'
    })

    emit('created')
    isOpen.value = false
  } catch (error) {
    console.error('[PurchaseOrderReceipt] Failed:', error)
    toast.add({
      title: '创建失败',
      description: '请检查录入内容后重试。',
      color: 'error',
      icon: 'i-lucide-circle-alert'
    })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    title="新增入库/激活记录"
    description="登记到货、开通、激活或入库处理结果。"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <div class="grid gap-4 md:grid-cols-2">
          <UFormField label="记录类型">
            <USelect
              v-model="state.receipt_type"
              :items="receiptTypeOptions"
              placeholder="请选择记录类型"
              class="w-full"
            />
          </UFormField>

          <UFormField label="处理状态">
            <USelect
              v-model="state.status"
              :items="receiptStatusOptions"
              placeholder="请选择处理状态"
              class="w-full"
            />
          </UFormField>

          <UFormField label="处理时间" class="md:col-span-2">
            <UInput
              v-model="state.processed_at"
              type="datetime-local"
              class="w-full"
            />
          </UFormField>
        </div>

        <UFormField label="说明">
          <UTextarea
            v-model="state.note"
            :rows="4"
            placeholder="补充到货、激活、开通或异常说明"
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
        <UButton :loading="submitting" icon="i-lucide-plus" @click="handleSubmit">
          创建记录
        </UButton>
      </div>
    </template>
  </UModal>
</template>
