<template>
  <UModal v-model:open="isOpen" title="复制文档" description="创建该文档的副本">
    <template #body>
      <div class="space-y-4 p-4">
        <UFormField label="文件名" required>
          <UInput v-model="newTitle" placeholder="请输入文件名" class="w-full" />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="outline" @click="isOpen = false">
          取消
        </UButton>
        <UButton
          color="primary"
          :disabled="!newTitle.trim() || submitting"
          :loading="submitting"
          @click="handleCopy"
        >
          确定
        </UButton>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
interface CopyDocumentResponse {
  data: {
    uuid: string
    title: string
  }
}

const getErrorMessage = (error: unknown, fallback: string) => {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (typeof error === 'object' && error !== null && 'data' in error) {
    const data = error.data
    if (typeof data === 'object' && data !== null && 'message' in data) {
      const message = data.message
      if (typeof message === 'string' && message) {
        return message
      }
    }
  }

  return fallback
}

const props = defineProps<{
  open: boolean
  documentUuid: string
  documentTitle: string
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'success', data: { uuid: string, title: string }): void
}>()

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const toast = useToast()
const submitting = ref(false)
const newTitle = ref('')

function generateCopyTitle(title: string): string {
  // 去掉 .md 后缀（如果有）
  const base = title.replace(/\.md$/i, '')
  const today = new Date()
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`
  // 匹配已有的 _YYYYMMDD 后缀
  const datePattern = /_\d{8}$/
  if (datePattern.test(base)) {
    return base.replace(datePattern, `_${dateStr}`)
  }
  return `${base}_${dateStr}`
}

const handleCopy = async () => {
  if (!newTitle.value.trim()) return

  submitting.value = true
  try {
    const res = await $fetch<CopyDocumentResponse>(`/api/documents/${props.documentUuid}/copy`, {
      method: 'POST',
      body: { title: newTitle.value.trim() }
    })

    toast.add({
      title: '复制成功',
      description: `已创建文档"${res.data.title}"`,
      color: 'success'
    })

    isOpen.value = false
    emit('success', res.data)
  } catch (error: unknown) {
    toast.add({
      title: '复制失败',
      description: getErrorMessage(error, '复制文档失败'),
      color: 'error'
    })
  } finally {
    submitting.value = false
  }
}

watch(isOpen, (val) => {
  if (val) {
    newTitle.value = generateCopyTitle(props.documentTitle)
  }
})
</script>
