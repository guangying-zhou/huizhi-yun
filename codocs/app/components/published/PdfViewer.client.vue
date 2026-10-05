<script setup lang="ts">
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?worker&url'

const props = defineProps<{ src: string, title?: string }>()
const { resolveCurrentAppPath } = useAppUrls()
const viewport = useTemplateRef<HTMLDivElement>('viewport')
const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
const pageNumber = ref(1)
const pageCount = ref(0)
const zoom = ref(1)
const loading = ref(true)
const rendering = ref(false)
const errorMessage = ref('')
let document: PDFDocumentProxy | undefined
let loadingTask: PDFDocumentLoadingTask | undefined
let renderTask: RenderTask | undefined
let generation = 0
let renderGeneration = 0
let resizeObserver: ResizeObserver | undefined
let resizeTimer: ReturnType<typeof setTimeout> | undefined
let previousWidth = 0

async function renderPage() {
  const id = ++renderGeneration
  const currentDocument = document
  const currentCanvas = canvas.value
  if (!currentDocument || !currentCanvas || !viewport.value) return
  rendering.value = true
  errorMessage.value = ''
  const previousRender = renderTask
  previousRender?.cancel()
  try {
    await previousRender?.promise.catch(() => {})
    const page = await currentDocument.getPage(pageNumber.value)
    if (id !== renderGeneration) return
    const original = page.getViewport({ scale: 1 })
    const width = Math.max(1, viewport.value.clientWidth - 16)
    const fitted = page.getViewport({ scale: width / original.width * zoom.value })
    // Bound memory on large pages while keeping text sharp on high-density screens.
    const ratio = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(16_000_000 / (fitted.width * fitted.height)))
    currentCanvas.width = Math.ceil(fitted.width * ratio)
    currentCanvas.height = Math.ceil(fitted.height * ratio)
    currentCanvas.style.width = `${fitted.width}px`
    currentCanvas.style.height = `${fitted.height}px`
    renderTask = page.render({
      canvas: currentCanvas,
      viewport: fitted,
      transform: [ratio, 0, 0, ratio, 0, 0]
    })
    // Only canvas is rendered: no selectable text or interactive annotation layer.
    await renderTask.promise
  } catch {
    if (id === renderGeneration) errorMessage.value = '此页加载失败，请重试。'
  } finally {
    if (id === renderGeneration) rendering.value = false
  }
}

async function loadDocument() {
  const id = ++generation
  renderGeneration++
  renderTask?.cancel()
  void loadingTask?.destroy().catch(() => {})
  document = undefined
  loadingTask = undefined
  pageCount.value = 0
  pageNumber.value = 1
  zoom.value = 1
  loading.value = true
  rendering.value = false
  errorMessage.value = ''
  try {
    const pdfjs = await import('pdfjs-dist')
    if (id !== generation) return
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
    const assetBase = resolveCurrentAppPath(`/pdfjs/${pdfjs.version}/`)
    const task = pdfjs.getDocument({
      url: props.src,
      cMapUrl: `${assetBase}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${assetBase}standard_fonts/`,
      wasmUrl: `${assetBase}wasm/`,
      // The authenticated endpoint serves one complete response and records one read.
      disableRange: true,
      disableStream: true
    })
    loadingTask = task
    const loaded = await task.promise
    if (id !== generation) return
    document = loaded
    pageCount.value = loaded.numPages
    loading.value = false
    await nextTick()
    await renderPage()
  } catch {
    if (id === generation) errorMessage.value = 'PDF 加载失败，请重试。'
  } finally {
    if (id === generation) loading.value = false
  }
}

async function retry() {
  errorMessage.value = ''
  await nextTick()
  if (document) await renderPage()
  else await loadDocument()
}

watch(() => props.src, loadDocument)
watch([pageNumber, zoom], () => {
  if (viewport.value) viewport.value.scrollTop = 0
  void renderPage()
})
onMounted(() => {
  resizeObserver = new ResizeObserver(([entry]) => {
    const width = entry?.contentRect.width || 0
    if (!width || width === previousWidth) return
    previousWidth = width
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(() => {
      void renderPage()
    }, 100)
  })
  if (viewport.value) resizeObserver.observe(viewport.value)
  void loadDocument()
})
onBeforeUnmount(() => {
  generation++
  renderGeneration++
  clearTimeout(resizeTimer)
  resizeObserver?.disconnect()
  renderTask?.cancel()
  void loadingTask?.destroy().catch(() => {})
})
</script>

<template>
  <section class="min-w-0 rounded-lg border border-default bg-default" :aria-label="title || 'PDF 文档'" :aria-busy="loading || rendering">
    <div class="flex flex-wrap items-center justify-center gap-2 border-b border-default p-2">
      <UButton
        icon="i-lucide-chevron-left"
        aria-label="上一页"
        color="neutral"
        variant="outline"
        :disabled="loading || rendering || pageNumber <= 1"
        @click="pageNumber--"
      />
      <span class="text-sm tabular-nums" aria-live="polite">{{ pageCount ? pageNumber : 0 }} / {{ pageCount }} 页</span>
      <UButton
        icon="i-lucide-chevron-right"
        aria-label="下一页"
        color="neutral"
        variant="outline"
        :disabled="loading || rendering || pageNumber >= pageCount"
        @click="pageNumber++"
      />
      <UButton
        icon="i-lucide-minus"
        aria-label="缩小"
        color="neutral"
        variant="ghost"
        :disabled="loading || rendering || zoom <= 1"
        @click="zoom = Math.max(1, zoom - 0.25)"
      />
      <span class="text-sm tabular-nums">{{ Math.round(zoom * 100) }}%</span>
      <UButton
        icon="i-lucide-plus"
        aria-label="放大"
        color="neutral"
        variant="ghost"
        :disabled="loading || rendering || zoom >= 3"
        @click="zoom = Math.min(3, zoom + 0.25)"
      />
    </div>
    <div v-if="errorMessage" class="space-y-3 p-6 text-center" role="alert">
      <p>{{ errorMessage }}</p>
      <UButton variant="outline" @click="retry">
        重试
      </UButton>
    </div>
    <div v-if="loading || rendering" class="flex items-center justify-center gap-2 p-3 text-muted" role="status">
      <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />正在加载 PDF…
    </div>
    <div v-show="!errorMessage" ref="viewport" class="max-h-[calc(100dvh-16rem)] min-h-64 w-full overflow-auto bg-elevated p-2">
      <canvas
        ref="canvas"
        class="mx-auto block select-none"
        :class="{ invisible: loading || rendering || errorMessage }"
        :aria-label="`${title || 'PDF 文档'}，第 ${pageNumber} 页`"
        role="img"
        @contextmenu.prevent
        @dragstart.prevent
      />
    </div>
  </section>
</template>
