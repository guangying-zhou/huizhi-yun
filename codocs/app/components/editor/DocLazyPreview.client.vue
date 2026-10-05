<script setup lang="ts">
/**
 * 文档懒加载预览组件
 * 按 Markdown 块安全切分内容，避免在 Mermaid、表格、代码块、列表中间截断。
 * 进入视口时按块追加后续内容，减少首屏渲染压力。
 */
import { buildPreviewChunks } from './previewMarkdownChunks'

const props = defineProps<{
  content: string
  watermarkText?: string
  disableSelection?: boolean
}>()

type EditorRef = {
  setMarkdown: (value: string) => void
  appendMarkdown: (value: string) => void
}

const editorRef = ref<EditorRef | null>(null)
const sentinelRef = ref<HTMLElement | null>(null)
const fullyLoaded = ref(false)
const editorReady = ref(false)
const nextChunkIndex = ref(1)

const chunks = buildPreviewChunks(props.content)
const initialContent = chunks[0] ?? props.content.replace(/\r\n?/g, '\n')
const hasMore = chunks.length > 1

let observer: IntersectionObserver | null = null

const loadMore = () => {
  if (fullyLoaded.value || !editorReady.value) return

  const nextChunk = chunks[nextChunkIndex.value]
  if (!nextChunk) {
    fullyLoaded.value = true
    observer?.disconnect()
    observer = null
    return
  }

  editorRef.value?.appendMarkdown(nextChunk)
  nextChunkIndex.value += 1

  if (nextChunkIndex.value >= chunks.length) {
    fullyLoaded.value = true
    observer?.disconnect()
    observer = null
  }
}

const setupObserver = () => {
  observer?.disconnect()
  observer = null
  if (!hasMore || fullyLoaded.value || !sentinelRef.value) return

  observer = new IntersectionObserver((entries) => {
    if (!entries[0]?.isIntersecting) return
    loadMore()
  }, {
    threshold: 0.1,
    rootMargin: '320px 0px'
  })

  observer.observe(sentinelRef.value as unknown as Element)
}

const onEditorReady = async () => {
  editorReady.value = true
  if (!hasMore) {
    fullyLoaded.value = true
    return
  }
  await nextTick()
  setupObserver()
}

onUnmounted(() => {
  observer?.disconnect()
})
</script>

<template>
  <div class="h-full">
    <EditorMilkdownEditor
      ref="editorRef"
      :model-value="initialContent"
      :watermark-text="watermarkText"
      :disable-selection="disableSelection"
      :show-sidebar="false"
      readonly
      @ready="onEditorReady"
    />
    <div
      v-if="hasMore && !fullyLoaded"
      ref="sentinelRef"
      class="h-1 w-full"
      aria-hidden="true"
    />
  </div>
</template>
