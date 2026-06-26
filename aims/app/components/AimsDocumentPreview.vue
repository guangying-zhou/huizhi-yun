<script setup lang="ts">
/**
 * 统一文档预览组件
 *   - codocs：嵌入 CodocsPreview iframe
 *   - repo：按 commit_id/ref 拉取 md 文本，用 MarkdownContent 渲染
 */
import { fetchRepoDocContent } from '~/composables/useAimsDocumentPicker'
import type { DocumentSource } from '~/composables/useAimsDocumentPicker'

const props = defineProps<{
  source: DocumentSource
  codocsUuid?: string | null
  projectId?: number | null
  repoProjectCode?: string | null
  repoFilePath?: string | null
  repoCommitId?: string | null
  title?: string | null
}>()

interface RepoContent {
  content: string
  path: string
  commit_id: string
  last_commit_id: string
}

const repoContent = ref<RepoContent | null>(null)
const repoLoading = ref(false)
const repoError = ref('')
const codocsReady = ref(false)
const codocsLoading = ref(false)
const codocsError = ref('')

async function prepareCodocsPreviewAccess() {
  codocsReady.value = false
  codocsError.value = ''
  if (props.source !== 'codocs') return
  if (!props.codocsUuid) return

  if (!props.projectId) {
    codocsReady.value = true
    return
  }

  codocsLoading.value = true
  try {
    await $fetch(`/api/v1/codocs/documents/${encodeURIComponent(props.codocsUuid)}/preview-access`, {
      method: 'POST',
      body: {
        projectId: props.projectId
      }
    })
    codocsReady.value = true
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message
      || (err as { message?: string })?.message
      || '无法准备 Codocs 预览权限'
    codocsError.value = msg
  } finally {
    codocsLoading.value = false
  }
}

async function loadRepo() {
  repoError.value = ''
  repoContent.value = null
  if (props.source !== 'repo' || !props.repoProjectCode || !props.repoFilePath) return
  repoLoading.value = true
  try {
    const data = await fetchRepoDocContent(props.repoProjectCode, props.repoFilePath, {
      commitId: props.repoCommitId || undefined
    })
    if (data) {
      repoContent.value = {
        content: data.content,
        path: data.path,
        commit_id: data.commit_id,
        last_commit_id: data.last_commit_id
      }
    } else {
      repoError.value = '无法拉取仓库文档内容'
    }
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message
      || (err as { message?: string })?.message
      || '拉取失败'
    repoError.value = msg
  } finally {
    repoLoading.value = false
  }
}

watch(
  () => [props.source, props.repoProjectCode, props.repoFilePath, props.repoCommitId],
  () => {
    if (props.source === 'repo') loadRepo()
  },
  { immediate: true }
)

watch(
  () => [props.source, props.codocsUuid, props.projectId],
  () => {
    if (props.source === 'codocs') prepareCodocsPreviewAccess()
  },
  { immediate: true }
)

const showStaleWarning = computed(() => {
  if (props.source !== 'repo') return false
  if (!props.repoCommitId || !repoContent.value) return false
  return repoContent.value.last_commit_id && repoContent.value.last_commit_id !== props.repoCommitId
})
</script>

<template>
  <div class="h-full flex flex-col min-h-0">
    <!-- codocs -->
    <div v-if="source === 'codocs'" class="flex-1 min-h-0">
      <div v-if="codocsLoading" class="flex items-center justify-center h-full text-muted">
        <UIcon name="i-lucide-loader-2" class="size-5 animate-spin" />
      </div>
      <div v-else-if="codocsError" class="flex items-center gap-2 px-3 py-4 rounded-md bg-error/10 text-sm text-error">
        <UIcon name="i-lucide-triangle-alert" class="size-4" />
        {{ codocsError }}
      </div>
      <CodocsPreview v-else-if="codocsUuid && codocsReady" :key="`${codocsUuid}:${projectId || 'direct'}`" :uuid="codocsUuid" />
      <div v-else class="flex items-center justify-center h-full text-sm text-muted">
        未关联文档
      </div>
    </div>

    <!-- repo -->
    <div v-else class="flex-1 min-h-0 flex flex-col">
      <div v-if="repoLoading" class="flex items-center justify-center h-full text-muted">
        <UIcon name="i-lucide-loader-2" class="size-5 animate-spin" />
      </div>
      <div v-else-if="repoError" class="flex items-center gap-2 px-3 py-4 rounded-md bg-error/10 text-sm text-error">
        <UIcon name="i-lucide-triangle-alert" class="size-4" />
        {{ repoError }}
      </div>
      <template v-else-if="repoContent">
        <div class="flex items-center gap-2 text-xs text-muted font-mono mb-2 shrink-0">
          <UIcon name="i-lucide-file-text" class="size-3.5" />
          <span class="truncate">{{ repoContent.path }}</span>
          <span v-if="repoCommitId" class="ml-auto shrink-0">快照 @ {{ repoCommitId.slice(0, 8) }}</span>
          <span v-else class="ml-auto shrink-0">跟随默认分支</span>
        </div>
        <div
          v-if="showStaleWarning"
          class="flex items-center gap-2 px-3 py-2 rounded-md bg-warning/10 text-xs text-warning mb-2 shrink-0"
        >
          <UIcon name="i-lucide-triangle-alert" class="size-3.5" />
          仓库中该文件的最新版本（{{ repoContent.last_commit_id.slice(0, 8) }}）与当前快照不同
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto">
          <MarkdownContent :markdown="repoContent.content" />
        </div>
      </template>
      <div v-else class="flex items-center justify-center h-full text-sm text-muted">
        未关联文档
      </div>
    </div>
  </div>
</template>
