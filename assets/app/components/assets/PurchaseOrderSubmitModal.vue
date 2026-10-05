<script setup lang="ts">
import type { ApiResponse } from '~/types'

const props = defineProps<{
  open: boolean
  orderId: number | null
  orderNo?: string | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'submitted': []
}>()

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const toast = useToast()
const submitting = ref(false)
const workflowInstanceId = ref('')

watch(() => props.open, (open) => {
  if (open) {
    workflowInstanceId.value = ''
  }
})

async function handleSubmit() {
  if (!props.orderId) {
    return
  }

  submitting.value = true

  try {
    await $fetch<ApiResponse<{ id: number }>>(`/api/v1/purchase-orders/${props.orderId}/submit`, {
      method: 'POST',
      body: {
        workflow_instance_id: workflowInstanceId.value.trim() || null
      }
    })

    toast.add({
      title: '采购单已提交审批',
      description: props.orderNo ? `${props.orderNo} 已进入审批流程。` : '采购单已进入审批流程。',
      color: 'success',
      icon: 'i-lucide-check'
    })

    emit('submitted')
    isOpen.value = false
  } catch (error) {
    console.error('[PurchaseOrderSubmit] Failed:', error)
    toast.add({
      title: '提交失败',
      description: '请稍后重试。',
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
    title="提交审批"
    description="将当前采购单推进到审批状态，可选填外部流程实例号。"
    :ui="{ content: 'sm:max-w-xl' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <UFormField label="流程实例号">
          <UInput
            v-model="workflowInstanceId"
            placeholder="例如：WF-PO-202603-001"
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
        <UButton :loading="submitting" icon="i-lucide-send" @click="handleSubmit">
          提交审批
        </UButton>
      </div>
    </template>
  </UModal>
</template>
