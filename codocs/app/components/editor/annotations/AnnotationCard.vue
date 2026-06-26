<script setup lang="ts">
import { ref, computed } from 'vue'
import { formatDistanceToNow } from 'date-fns'
import { zhCN } from 'date-fns/locale'

interface Reply {
  id: number
  content: string
  author_id: string
  author_name: string
  created_at: string
}

interface Annotation {
  id: number
  content: string
  selected_text: string
  author_id: string
  author_name: string
  created_at: string
  status?: string
  replies?: Reply[]
}

const props = defineProps<{
  annotation: Annotation
  showClose?: boolean
}>()

const emit = defineEmits<{
  (e: 'reply', annotationId: number, content: string): void
  (e: 'resolve' | 'delete' | 'click-card', annotationId: number): void
  (e: 'delete-reply', annotationId: number, replyId: number): void
  (e: 'close'): void
}>()

const { user } = useAuth()
const currentUserId = computed(() => user.value || 'user1')

const replyContent = ref('')
const showReplyInput = ref(true)
console.log('currentUserId', currentUserId.value)
console.log('props.annotation.author_id', props.annotation.author_id)
const isAuthor = computed(() => props.annotation.author_id === currentUserId.value)
const isResolved = computed(() => props.annotation.status === 'resolved')

const formatDate = (date: string) => {
  return formatDistanceToNow(new Date(date), { addSuffix: true, locale: zhCN })
}

const handleReply = () => {
  if (!replyContent.value.trim()) return
  emit('reply', props.annotation.id, replyContent.value)
  replyContent.value = ''
  showReplyInput.value = false
}
</script>

<template>
  <div
    class="border rounded-lg bg-white dark:bg-gray-800 transition-all duration-200"
    :class="[
      isResolved ? 'opacity-60' : 'opacity-100',
      'hover:shadow-md border-gray-200 dark:border-gray-700'
    ]"
    @click="$emit('click-card', annotation.id)"
  >
    <!-- Header -->
    <div class="flex items-start justify-between p-3 border-b border-gray-100 dark:border-gray-700/50">
      <div class="flex items-center gap-2">
        <UAvatar :alt="annotation.author_name" size="xs" />
        <div class="flex flex-col">
          <span class="text-xs font-medium text-gray-900 dark:text-gray-100">{{ annotation.author_name
          }}</span>
          <span class="text-[10px] text-gray-500">{{ formatDate(annotation.created_at) }}</span>
        </div>
      </div>

      <div class="flex items-center gap-1">
        <template v-if="!isResolved">
          <UButton
            v-if="isAuthor"
            icon="i-lucide-circle-check-big"
            color="neutral"
            variant="ghost"
            size="xs"
            title="解决"
            @click.stop="$emit('resolve', annotation.id)"
          />
          <UButton
            v-if="isAuthor"
            icon="i-lucide-trash"
            color="neutral"
            variant="ghost"
            size="xs"
            class="text-red-500 hover:text-red-600"
            title="删除"
            @click.stop="$emit('delete', annotation.id)"
          />
        </template>
        <UBadge
          v-else
          color="primary"
          size="xs"
          variant="subtle"
        >
          已解决
        </UBadge>

        <UButton
          v-if="showClose"
          icon="i-lucide-x"
          color="neutral"
          variant="ghost"
          size="xs"
          @click.stop="$emit('close')"
        />
      </div>
    </div>

    <!-- Quoted Text (Context) -->
    <div class="px-3 py-2 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-700/50">
      <div class="text-xs text-gray-500 italic border-l-2 border-primary-500 pl-2 line-clamp-2">
        {{ annotation.selected_text }}
      </div>
    </div>

    <!-- Content -->
    <div class="p-3 text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
      {{ annotation.content }}
    </div>

    <!-- Replies -->
    <div v-if="annotation.replies?.length" class="px-3 pb-3 space-y-3">
      <div
        v-for="reply in annotation.replies"
        :key="reply.id"
        class="flex gap-2 text-sm pl-2 border-l border-gray-200 dark:border-gray-700"
      >
        <UAvatar :alt="reply.author_name" size="2xs" class="mt-0.5" />
        <div class="flex-1 min-w-0">
          <div class="flex justify-between items-baseline">
            <span class="text-xs font-semibold text-gray-700 dark:text-gray-300">{{ reply.author_name
            }}</span>
            <span class="text-[10px] text-gray-400">{{ formatDate(reply.created_at) }}</span>
          </div>
          <div class="text-gray-600 dark:text-gray-400 mt-0.5 break-words">
            {{ reply.content }}
          </div>
        </div>
        <UButton
          v-if="reply.author_id === currentUserId"
          icon="i-lucide-trash"
          color="neutral"
          variant="ghost"
          size="xs"
          class="opacity-0 group-hover:opacity-100 transition-opacity"
          @click.stop="$emit('delete-reply', annotation.id, reply.id)"
        />
      </div>
    </div>

    <!-- Reply Input Trigger -->
    <div v-if="!isResolved" class="px-3 pb-3 pt-1">
      <div v-if="!showReplyInput" class="flex">
        <UButton
          label="回复..."
          variant="link"
          color="neutral"
          size="xs"
          class="p-0 text-gray-400 hover:text-primary-500"
          @click.stop="showReplyInput = true"
        />
      </div>

      <div v-else class="flex flex-col gap-2 mt-2" @click.stop>
        <UTextarea
          v-model="replyContent"
          autoresize
          placeholder="写下回复..."
          size="sm"
          :rows="1"
          class="w-full"
        />
        <div class="flex justify-end gap-2">
          <UButton
            label="取消"
            size="xs"
            color="neutral"
            variant="ghost"
            @click="showReplyInput = false; $emit('close')"
          />
          <UButton
            label="发送"
            size="xs"
            color="primary"
            :disabled="!replyContent.trim()"
            @click="handleReply"
          />
        </div>
      </div>
    </div>
  </div>
</template>
