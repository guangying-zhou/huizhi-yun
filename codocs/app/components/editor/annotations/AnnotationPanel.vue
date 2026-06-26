<script setup lang="ts">
import AnnotationCard from './AnnotationCard.vue'

interface Annotation {
  id: number
  content: string
  selected_text: string
  author_id: string
  author_name: string
  created_at: string
  status?: string
  replies?: { id: number, content: string, author_id: string, author_name: string, created_at: string }[]
}

defineProps<{
  annotations: Annotation[]
  currentUserId: string
}>()

const emit = defineEmits<{
  (e: 'reply', annotationId: number, content: string): void
  (e: 'resolve' | 'delete' | 'click-card', annotationId: number): void
  (e: 'delete-reply', annotationId: number, replyId: number): void
}>()
</script>

<template>
  <div class="flex-1 min-h-0 h-full overflow-y-auto p-4 custom-scrollbar">
    <div
      v-if="annotations.length === 0"
      class="flex flex-col items-center justify-center h-64 text-gray-500 dark:text-gray-400"
    >
      <UIcon name="i-lucide-message-square-text" class="w-12 h-12 mb-3 opacity-30" />
      <p class="text-sm font-medium">
        暂无标注
      </p>
      <p class="text-xs mt-1 opacity-70">
        选中编辑器中的文本添加标注
      </p>
    </div>

    <div v-else class="space-y-4 pb-4">
      <div v-for="ann in annotations" :key="ann.id">
        <AnnotationCard
          :annotation="ann"
          @reply="(id, content) => emit('reply', id, content)"
          @resolve="(id) => emit('resolve', id)"
          @delete="(id) => emit('delete', id)"
          @delete-reply="(id, replyId) => emit('delete-reply', id, replyId)"
          @click-card="(id) => emit('click-card', id)"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
    width: 4px;
}

.custom-scrollbar::-webkit-scrollbar-track {
    background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
    background-color: rgba(156, 163, 175, 0.3);
    border-radius: 2px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
    background-color: rgba(156, 163, 175, 0.5);
}
</style>
