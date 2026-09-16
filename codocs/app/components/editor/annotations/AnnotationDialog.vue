<script setup lang="ts">
import { ref } from 'vue'

const open = defineModel<boolean>('open', { default: false })

defineProps<{
  selectedText: string
}>()

const emit = defineEmits<{
  (e: 'create', content: string): void
}>()

const content = ref('')

const handleCreate = (closeFn: () => void) => {
  if (!content.value.trim()) return
  emit('create', content.value)
  content.value = ''
  closeFn()
}

const handleClose = (closeFn: () => void) => {
  content.value = ''
  closeFn()
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="添加标注"
    description="针对选中的文本添加批注"
    :ui="{ footer: 'justify-end' }"
  >
    <!-- Invisible trigger, controlled programmatically -->
    <span class="hidden" />

    <template #body>
      <!-- Selected Text Preview -->
      <div class="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 mb-4">
        <div class="text-xs text-gray-500 dark:text-gray-400 mb-1 font-medium">
          选中文本:
        </div>
        <div
          class="text-sm text-gray-700 dark:text-gray-300 italic line-clamp-3 border-l-2 border-primary-500 pl-2"
        >
          "{{ selectedText }}"
        </div>
      </div>

      <!-- Input -->
      <UTextarea
        v-model="content"
        placeholder="写下你的标注..."
        autoresize
        :rows="3"
        class="w-full"
      />
    </template>

    <template #footer="{ close }">
      <UButton
        label="取消"
        color="neutral"
        variant="outline"
        @click="handleClose(close)"
      />
      <UButton
        label="创建"
        color="primary"
        :disabled="!content.trim()"
        @click="handleCreate(close)"
      />
    </template>
  </UModal>
</template>
