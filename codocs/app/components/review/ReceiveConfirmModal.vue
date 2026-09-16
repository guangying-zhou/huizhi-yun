<template>
  <UModal v-model:open="isOpen" title="确认接收" description="请在确认对方已收到文件后再登记">
    <template #body>
      <div class="p-4 space-y-4">
        <UAlert
          color="warning"
          icon="i-lucide-mail-check"
          title="接收确认"
          :description="`请确保对方已经收到《${docTitle || '当前文档'}》，再登记接收日期。`"
        />

        <UFormField label="接收日期" required class="w-full">
          <UInput
            v-model="receiveDate"
            type="date"
            :max="todayDateString"
            class="w-full"
          />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="outline" @click="isOpen = false">
          取消
        </UButton>
        <UButton color="primary" :loading="submitting" @click="handleConfirm">
          确认接收
        </UButton>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
interface ApiErrorLike {
  data?: {
    message?: string
  }
  message?: string
}

const props = defineProps<{
  open: boolean
  reviewId: number
  docTitle?: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'success'): void
}>()

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const toast = useToast()
const submitting = ref(false)
const receiveDate = ref('')

const getTodayDateString = () => {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const todayDateString = getTodayDateString()

const resetForm = () => {
  receiveDate.value = todayDateString
}

watch(isOpen, (open) => {
  if (open) {
    resetForm()
    return
  }

  resetForm()
})

const handleConfirm = async () => {
  if (!receiveDate.value) {
    toast.add({
      title: '缺少接收日期',
      description: '请选择接收日期',
      color: 'warning'
    })
    return
  }

  if (receiveDate.value > todayDateString) {
    toast.add({
      title: '接收日期无效',
      description: '接收日期不能晚于今天',
      color: 'warning'
    })
    return
  }

  submitting.value = true
  try {
    await $fetch(`/api/reviews/${props.reviewId}/receive`, {
      method: 'POST',
      body: {
        receiveDate: receiveDate.value
      }
    })

    toast.add({
      title: '接收已确认',
      description: '系统已记录对方接收情况',
      color: 'success'
    })

    isOpen.value = false
    emit('success')
  } catch (error: unknown) {
    const err = error as ApiErrorLike
    toast.add({
      title: '确认失败',
      description: err.data?.message || err.message || '确认接收失败',
      color: 'error'
    })
  } finally {
    submitting.value = false
  }
}
</script>
