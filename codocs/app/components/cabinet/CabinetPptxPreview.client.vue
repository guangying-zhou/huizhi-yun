<script setup lang="ts">
import { init } from 'pptx-preview'

const props = defineProps<{
  src: string
  filename?: string
}>()

const container = ref<HTMLElement | null>(null)
const loading = ref(false)
const errorMessage = ref('')

let previewer: ReturnType<typeof init> | null = null
let renderToken = 0
let resizeObserver: ResizeObserver | null = null
let resizeTimer: ReturnType<typeof setTimeout> | null = null
let observedWidth = 0

function getContainerElement() {
  return container.value instanceof HTMLElement ? container.value : null
}

function getResizeTargetElement() {
  const containerElement = getContainerElement()
  return containerElement?.parentElement instanceof HTMLElement ? containerElement.parentElement : null
}

function getPreviewSize() {
  const containerElement = getContainerElement()
  const resizeTarget = getResizeTargetElement()
  return Math.max(640, Math.min(resizeTarget?.clientWidth || containerElement?.clientWidth || 960, 1280))
}

function cleanupPreviewer() {
  if (resizeTimer) {
    clearTimeout(resizeTimer)
    resizeTimer = null
  }

  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }

  previewer?.destroy()
  previewer = null
}

async function renderPreview() {
  const containerElement = getContainerElement()
  if (!containerElement || !props.src) return

  const token = ++renderToken
  cleanupPreviewer()
  loading.value = true
  errorMessage.value = ''

  try {
    const response = await fetch(props.src, { credentials: 'same-origin' })
    if (!response.ok) {
      throw new Error(`加载失败 (${response.status})`)
    }

    const buffer = await response.arrayBuffer()
    const currentContainerElement = getContainerElement()
    if (token !== renderToken || !currentContainerElement) return

    const width = getPreviewSize()
    previewer = init(currentContainerElement, {
      width,
      mode: 'list'
    })
    await previewer.preview(buffer)

    if (token !== renderToken) return

    const resizeTarget = getResizeTargetElement()
    observedWidth = resizeTarget?.clientWidth || width
    if (!resizeTarget) return

    resizeObserver = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width || 0
      if (Math.abs(nextWidth - observedWidth) < 8) return

      observedWidth = nextWidth
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        renderPreview()
      }, 120)
    })
    resizeObserver.observe(resizeTarget)
  } catch (error) {
    if (token !== renderToken) return
    errorMessage.value = error instanceof Error ? error.message : 'PPTX 预览加载失败'
  } finally {
    if (token === renderToken) {
      loading.value = false
    }
  }
}

watch(
  () => props.src,
  () => {
    renderPreview()
  }
)

onMounted(() => {
  renderPreview()
})

onBeforeUnmount(() => {
  renderToken += 1
  cleanupPreviewer()
})
</script>

<template>
  <div class="relative bg-muted/20 pt-4 rounded-b-lg">
    <div
      ref="container"
      class="h-full overflow-auto p-0"
      :class="errorMessage ? 'hidden' : ''"
    />

    <div
      v-if="loading"
      class="absolute inset-0 z-10 flex items-center justify-center bg-default/80 backdrop-blur-sm"
    >
      <div class="flex items-center gap-2 text-sm text-muted">
        <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-primary" />
        <span>正在加载演示文稿</span>
      </div>
    </div>

    <div
      v-else-if="errorMessage"
      class="flex min-h-[calc(100vh-200px)] items-center justify-center p-8"
    >
      <div class="max-w-md text-center space-y-3">
        <UIcon name="i-lucide-presentation" class="mx-auto size-10 text-dimmed" />
        <p class="text-sm font-medium text-default">
          {{ filename || 'PPTX 文件' }}
        </p>
        <p class="text-sm text-muted">
          {{ errorMessage }}
        </p>
      </div>
    </div>
  </div>
</template>
