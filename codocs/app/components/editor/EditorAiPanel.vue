<script setup lang="ts">
/**
 * 编辑器 AI 侧边栏面板
 * 提供 AI 摘要生成功能，支持加载已保存的摘要
 */

const props = defineProps<{
  markdown: string
  documentId: string
  savedAbstract?: string
  readonly?: boolean
}>()

const emit = defineEmits<{
  'update-abstract': [abstract: string]
}>()

const { loading, error, summarize } = useAi()
const abstract = ref('')
const generated = ref(false)

// 加载已保存的摘要
watch(() => props.savedAbstract, (val) => {
  if (val && !abstract.value) {
    abstract.value = val
    generated.value = true
  }
}, { immediate: true })

// 生成摘要
const handleSummarize = async () => {
  if (!props.markdown || props.markdown.trim().length < 20) {
    return
  }

  try {
    const result = await summarize(props.markdown)
    abstract.value = result
    generated.value = true
    emit('update-abstract', result)
  } catch {
    // error 已在 useAi 中设置
  }
}

// 保存摘要到数据库
const saving = ref(false)
const saved = ref(false)
const handleSaveAbstract = async () => {
  if (!abstract.value || !props.documentId) return

  saving.value = true
  try {
    await $fetch('/api/ai/abstract', {
      method: 'POST',
      body: {
        documentId: props.documentId,
        abstract: abstract.value
      }
    })
    saved.value = true
    emit('update-abstract', abstract.value)
    setTimeout(() => {
      saved.value = false
    }, 2000)
  } catch {
    // 静默处理
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="p-4 space-y-4">
    <!-- AI 摘要 -->
    <div>
      <div class="flex items-center justify-between mb-2">
        <h4 class="text-sm font-medium text-gray-700 dark:text-gray-300">
          AI 摘要
        </h4>
      </div>

      <p class="text-xs text-gray-500 dark:text-gray-400 mb-3">
        {{ readonly ? '只读模式下无法生成摘要' : '基于当前文档内容生成摘要' }}
      </p>

      <!-- 生成按钮 -->
      <UButton
        :loading="loading"
        :disabled="readonly || !markdown || markdown.trim().length < 20"
        size="sm"
        variant="soft"
        icon="i-lucide-sparkles"
        :label="generated ? '重新生成' : '生成摘要'"
        class="w-full mb-3"
        @click="handleSummarize"
      />

      <!-- 错误提示 -->
      <div v-if="error" class="text-xs text-error bg-error/10 rounded-lg p-2 mb-3">
        {{ error }}
      </div>

      <!-- 摘要结果 -->
      <div v-if="abstract" class="space-y-2">
        <div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
          {{ abstract }}
        </div>
        <div class="flex justify-end">
          <UButton
            size="xs"
            variant="soft"
            color="success"
            :loading="saving"
            :disabled="readonly"
            :icon="saved ? 'i-lucide-check' : 'i-lucide-save'"
            :label="saved ? '已保存' : '保存摘要'"
            @click="handleSaveAbstract"
          />
        </div>
      </div>

      <!-- 空状态 -->
      <div v-else-if="!loading" class="text-center py-6">
        <UIcon name="i-lucide-sparkles" class="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
        <p class="text-xs text-gray-400 dark:text-gray-500">
          点击上方按钮生成摘要
        </p>
      </div>
    </div>

    <!-- 分隔线 -->
    <hr class="border-gray-200 dark:border-gray-700">

    <!-- 使用提示 -->
    <div>
      <h4 class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
        AI 助手
      </h4>
      <div class="space-y-2 text-xs text-gray-500 dark:text-gray-400">
        <div class="flex items-start gap-2">
          <UIcon name="i-lucide-mouse-pointer-click" class="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>选中文本后点击工具栏 AI 按钮使用润色、精简、扩展、翻译等功能</span>
        </div>
        <div class="flex items-start gap-2">
          <UIcon name="i-lucide-wand-sparkles" class="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>AI 将基于选中内容进行处理，结果可预览后决定是否采纳</span>
        </div>
      </div>
    </div>
  </div>
</template>
