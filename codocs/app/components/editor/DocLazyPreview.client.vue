<script setup lang="ts">
/**
 * 文档懒加载预览组件
 * 按 Markdown 块安全切分内容，避免在 Mermaid、表格、代码块、列表中间截断。
 * 进入视口时按块追加后续内容，减少首屏渲染压力。
 */
const props = defineProps<{
  content: string
  watermarkText?: string
}>()

const INITIAL_CHARS = 3000
const CHUNK_CHARS = 3000
const MIN_CHUNK_CHARS = 1800

const ORDERED_LIST_PATTERN = /^\s{0,3}\d+\.\s+/
const UNORDERED_LIST_PATTERN = /^\s{0,3}[-+*]\s+/
const TASK_LIST_PATTERN = /^\s{0,3}[-+*]\s+\[[ xX]\]\s+/
const BLOCKQUOTE_PATTERN = /^\s{0,3}>\s?/
const FENCE_PATTERN = /^(\s*)(`{3,}|~{3,})(.*)$/
const TABLE_ROW_PATTERN = /^\s*\|(?:.*\|)+\s*$/
const TABLE_DIVIDER_PATTERN = /^\s*\|?(?:\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?\s*$/
const THEMATIC_BREAK_PATTERN = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/
const BLANK_PATTERN = /^\s*$/

type EditorRef = {
  setMarkdown: (value: string) => void
  appendMarkdown: (value: string) => void
}

const normalizeMarkdown = (value: string) => value.replace(/\r\n?/g, '\n')

const isBlankLine = (line: string | undefined) => !line || BLANK_PATTERN.test(line)
const isListLine = (line: string | undefined) => Boolean(line && (ORDERED_LIST_PATTERN.test(line) || UNORDERED_LIST_PATTERN.test(line) || TASK_LIST_PATTERN.test(line)))
const isIndentedContinuation = (line: string | undefined) => Boolean(line && /^(?:\s{2,}|\t+)/.test(line))
const isTableStart = (lines: string[], index: number) => {
  const current = lines[index] ?? ''
  const next = lines[index + 1] ?? ''
  return TABLE_ROW_PATTERN.test(current) && TABLE_DIVIDER_PATTERN.test(next)
}

const consumeTrailingBlankLines = (lines: string[], index: number) => {
  let cursor = index
  while (cursor < lines.length && isBlankLine(lines[cursor])) {
    cursor += 1
  }
  return cursor
}

const extractFencedBlock = (lines: string[], start: number) => {
  const openingLine = lines[start] ?? ''
  const match = openingLine.match(FENCE_PATTERN)
  if (!match) return start + 1

  const fenceMarker = match[2]
  if (!fenceMarker) return start + 1
  const fenceChar = fenceMarker[0]
  const minFenceLength = fenceMarker.length
  let cursor = start + 1

  while (cursor < lines.length) {
    const line = lines[cursor] ?? ''
    const closingMatch = line.match(/^(\s*)(`{3,}|~{3,})\s*$/)
    const closingFenceMarker = closingMatch?.[2]
    if (closingFenceMarker && closingFenceMarker[0] === fenceChar && closingFenceMarker.length >= minFenceLength) {
      cursor += 1
      break
    }
    cursor += 1
  }

  return consumeTrailingBlankLines(lines, cursor)
}

const extractTableBlock = (lines: string[], start: number) => {
  let cursor = start + 2
  while (cursor < lines.length && TABLE_ROW_PATTERN.test(lines[cursor] ?? '')) {
    cursor += 1
  }
  return consumeTrailingBlankLines(lines, cursor)
}

const extractBlockquote = (lines: string[], start: number) => {
  let cursor = start
  while (cursor < lines.length) {
    const line = lines[cursor] ?? ''
    if (isBlankLine(line)) {
      const next = lines[cursor + 1] ?? ''
      if (BLOCKQUOTE_PATTERN.test(next) || isIndentedContinuation(next)) {
        cursor += 1
        continue
      }
      cursor += 1
      break
    }
    if (!BLOCKQUOTE_PATTERN.test(line) && !isIndentedContinuation(line)) break
    cursor += 1
  }
  return consumeTrailingBlankLines(lines, cursor)
}

const extractListBlock = (lines: string[], start: number) => {
  let cursor = start + 1
  while (cursor < lines.length) {
    const line = lines[cursor] ?? ''
    if (isBlankLine(line)) {
      const next = lines[cursor + 1] ?? ''
      if (isListLine(next) || isIndentedContinuation(next)) {
        cursor += 1
        continue
      }
      cursor += 1
      break
    }
    if (isListLine(line) || isIndentedContinuation(line)) {
      cursor += 1
      continue
    }
    break
  }
  return consumeTrailingBlankLines(lines, cursor)
}

const extractParagraphBlock = (lines: string[], start: number) => {
  let cursor = start + 1
  while (cursor < lines.length) {
    const line = lines[cursor] ?? ''
    if (isBlankLine(line)) {
      cursor += 1
      break
    }
    if (
      line.match(FENCE_PATTERN)
      || isTableStart(lines, cursor)
      || BLOCKQUOTE_PATTERN.test(line)
      || isListLine(line)
      || THEMATIC_BREAK_PATTERN.test(line)
    ) {
      break
    }
    cursor += 1
  }
  return consumeTrailingBlankLines(lines, cursor)
}

const splitIntoMarkdownBlocks = (full: string) => {
  const normalized = normalizeMarkdown(full)
  const lines = normalized.split('\n')
  const blocks: string[] = []
  let cursor = 0

  while (cursor < lines.length) {
    const start = cursor
    const line = lines[cursor] ?? ''

    if (isBlankLine(line)) {
      cursor = consumeTrailingBlankLines(lines, cursor)
    } else if (line.match(FENCE_PATTERN)) {
      cursor = extractFencedBlock(lines, cursor)
    } else if (isTableStart(lines, cursor)) {
      cursor = extractTableBlock(lines, cursor)
    } else if (BLOCKQUOTE_PATTERN.test(line)) {
      cursor = extractBlockquote(lines, cursor)
    } else if (isListLine(line)) {
      cursor = extractListBlock(lines, cursor)
    } else if (THEMATIC_BREAK_PATTERN.test(line)) {
      cursor = consumeTrailingBlankLines(lines, cursor + 1)
    } else {
      cursor = extractParagraphBlock(lines, cursor)
    }

    const block = lines.slice(start, cursor).join('\n')
    if (block) {
      blocks.push(block)
    }
  }

  return blocks
}

const buildChunks = (full: string) => {
  const blocks = splitIntoMarkdownBlocks(full)
  if (blocks.length === 0) return full ? [normalizeMarkdown(full)] : []

  const chunks: string[] = []
  let currentChunk = ''
  let targetChars = INITIAL_CHARS

  const pushChunk = () => {
    if (!currentChunk) return
    chunks.push(currentChunk)
    currentChunk = ''
    targetChars = CHUNK_CHARS
  }

  for (const block of blocks) {
    if (!currentChunk) {
      currentChunk = block
      continue
    }

    const exceedsTarget = currentChunk.length + block.length > targetChars
    const reachedMinSize = currentChunk.length >= Math.min(targetChars, MIN_CHUNK_CHARS)

    if (exceedsTarget && reachedMinSize) {
      pushChunk()
      currentChunk = block
      continue
    }

    currentChunk += block
  }

  pushChunk()
  return chunks
}

const editorRef = ref<EditorRef | null>(null)
const sentinelRef = ref<HTMLElement | null>(null)
const fullyLoaded = ref(false)
const editorReady = ref(false)
const nextChunkIndex = ref(1)

const chunks = buildChunks(props.content)
const initialContent = chunks[0] ?? normalizeMarkdown(props.content)
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
