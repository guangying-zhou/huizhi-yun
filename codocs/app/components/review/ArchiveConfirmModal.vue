<template>
  <UModal v-model:open="isOpen" title="确认发布" description="文档审批已通过，确认发布吗？">
    <template #body>
      <div class="p-4">
        <UAlert
          color="info"
          icon="i-lucide-info"
          title="发布说明"
          description="发布后将根据审阅类型自动归档到对应栏目，原文档将标记为已发布状态"
        />
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="outline" @click="isOpen = false">
          取消
        </UButton>
        <UButton color="primary" :loading="submitting" @click="handleConfirm">
          确认发布
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

const handleConfirm = async () => {
  submitting.value = true
  try {
    await $fetch(`/api/reviews/${props.reviewId}/archive`, {
      method: 'POST',
      body: {}
    })

    toast.add({
      title: '归档成功',
      description: '文档已归档到目标栏目',
      color: 'success'
    })

    isOpen.value = false
    emit('success')
  } catch (error: unknown) {
    const err = error as ApiErrorLike
    toast.add({
      title: '归档失败',
      description: err.data?.message || err.message || '归档失败',
      color: 'error'
    })
  } finally {
    submitting.value = false
  }
}
</script>
