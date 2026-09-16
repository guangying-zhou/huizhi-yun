<script setup lang="ts">
import { parsePublishedAssetPath, publishedAssetShortPagePath, type PublishedAssetScope } from '~~/shared/utils/publishedAssetLink'

const props = defineProps<{ scope?: PublishedAssetScope, token?: string }>()
const route = useRoute()
const { resolveCurrentAppPath } = useAppUrls()
const requestFetch = useRequestFetch()
const { watermarkText } = useViewerWatermark()
const resolvedPath = ref('')
const asset = computed(() => parsePublishedAssetPath(props.token !== undefined ? resolvedPath.value : route.query.path, props.scope))
const title = computed(() => asset.value?.name || '已发布文档')
usePageTitle(title)

interface PreviewData { content?: string, preview_url?: string, file_ext?: string }
const preview = ref<PreviewData | null>(null)
const loading = ref(false)
const errorMessage = ref('')
let requestId = 0

async function loadDocument() {
  const id = ++requestId
  preview.value = null
  resolvedPath.value = ''
  errorMessage.value = ''
  loading.value = false
  if (props.token !== undefined ? !publishedAssetShortPagePath(props.token) : !asset.value) {
    errorMessage.value = '文档链接无效，请向发送人获取完整链接。'
    return
  }
  loading.value = true
  try {
    if (props.token !== undefined) {
      const link = await requestFetch<{ data: { path: string } }>(resolveCurrentAppPath(`/api/published-asset-links/${props.token}`))
      if (id !== requestId) return
      resolvedPath.value = link.data.path
    }
    if (!asset.value) throw new Error('invalid published asset')
    const endpoint = asset.value.scope === 'company' ? '/api/company-assets/preview' : '/api/dept-assets/preview'
    const response = await requestFetch<{ code: number, data: PreviewData }>(resolveCurrentAppPath(endpoint), {
      params: { path: asset.value.path }
    })
    if (id !== requestId) return
    preview.value = response.data
  } catch (error: unknown) {
    if (id !== requestId) return
    const status = (error as { statusCode?: number, status?: number }).statusCode || (error as { status?: number }).status
    errorMessage.value = status === 404
      ? '文档不存在或已移动，请向发送人获取最新链接。'
      : status === 401 || status === 403
        ? '当前账号无法访问此文档，请确认已登录并具有阅读权限。'
        : '文档加载失败，请重试。'
  } finally {
    if (id === requestId) loading.value = false
  }
}

watch([() => route.query.path, () => props.scope, () => props.token], loadDocument, { immediate: true })
onBeforeUnmount(() => {
  requestId++
})
</script>

<template>
  <UDashboardPanel grow>
    <div class="flex flex-col gap-3 border-b border-default bg-default px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <h1 class="min-w-0 break-words text-base font-semibold">
        {{ title }}
      </h1>
      <div class="flex shrink-0 flex-wrap gap-2 self-start sm:self-auto">
        <PublishedAssetLinkButton v-if="asset" :path="asset.path" />
        <CompanyAssetAccessRecords v-if="asset?.scope === 'company'" :path="asset.path" :title="title" />
      </div>
    </div>
    <main class="min-h-0 flex-1 overflow-auto bg-elevated p-3 sm:p-6" :aria-busy="loading">
      <div v-if="loading" class="flex items-center justify-center gap-2 py-12 text-muted" role="status">
        <UIcon name="i-lucide-loader-2" class="size-5 animate-spin" />
        正在加载文档…
      </div>
      <div v-else-if="errorMessage" class="mx-auto max-w-xl space-y-4 rounded-lg bg-default p-6 text-center" role="alert">
        <p>{{ errorMessage }}</p>
        <UButton v-if="asset || publishedAssetShortPagePath(token)" variant="outline" @click="loadDocument">
          重试
        </UButton>
      </div>
      <PublishedPdfViewer
        v-else-if="preview?.file_ext === 'pdf' && preview.preview_url"
        :src="preview.preview_url"
        :title="title"
      />
      <div v-else-if="preview?.content" class="published-content mx-auto max-w-4xl rounded-lg bg-default shadow-sm">
        <EditorDocLazyPreview
          :key="asset?.path"
          :content="preview.content"
          :watermark-text="watermarkText"
          disable-selection
        />
      </div>
      <p v-else class="py-12 text-center text-muted">
        此文档暂无可预览内容。
      </p>
    </main>
  </UDashboardPanel>
</template>

<style scoped>
/* Keep prose readable on phones; wide published tables scroll within themselves. */
@media (max-width: 639px) {
  .published-content :deep(.ProseMirror) {
    min-width: 0;
  }
}
</style>
