<script setup lang="ts">
import type { ProjectDocument } from '../../types'
import { useRecycleBin } from '../../composables/useRecycleBin'
import { useCodocsModule } from '../../../layer/useCodocsModule'

definePageMeta({ hostContentInset: false })

interface RestoreDocRecord {
  uuid: string
  title: string
  doc_type: string
  owner_uid?: string
  folder_id?: number | null
  dept_code?: string
  project_code?: string
}

interface DocumentPreviewData {
  content?: string
}

const toast = useToast()
const { user } = useAuth()
const { moduleUrl, hosted, cacheKey } = useCodocsModule()
const uid = computed(() => user.value || 'user1')

usePageTitle('回收站')

const { fetchTrashPage: fetchTrash, formatDeletedAt, formatDocLocation } = useRecycleBin()

// State
const trashDocuments = ref<ProjectDocument[]>([])
const trashLoading = ref(false)
const page = ref(1)
const pageSize = 20
const total = ref(0)
let loadGeneration = 0
let trashController: AbortController | undefined
onScopeDispose(() => {
  loadGeneration++
  trashController?.abort()
})

// Preview state
const selectedDoc = ref<ProjectDocument | null>(null)
const previewContent = ref('')
const previewLoading = ref(false)
let previewGeneration = 0
let previewController: AbortController | undefined
onScopeDispose(() => {
  previewGeneration++
  previewController?.abort()
})

// Restore modal state
const showRestoreModal = ref(false)
const restoreDoc = ref<RestoreDocRecord | null>(null)

// Load trash documents
const loadTrashDocuments = async () => {
  const epoch = ++loadGeneration
  trashController?.abort()
  trashController = new AbortController()
  trashLoading.value = true
  trashDocuments.value = []
  if (!user.value) {
    total.value = 0
    trashLoading.value = false
    return
  }
  try {
    // The Enterprise Host derives the owner from the verified session.
    const result = await fetchTrash({ type: 'private', ...(hosted ? {} : { owner: uid.value }), page: page.value, pageSize }, trashController.signal)
    if (epoch !== loadGeneration) return
    total.value = result.total
    const lastPage = Math.max(1, Math.ceil(total.value / pageSize))
    if (page.value > lastPage) {
      page.value = lastPage
      return
    }
    trashDocuments.value = result.items
  } catch {
    if (epoch === loadGeneration) {
      total.value = 0
      toast.add({ title: '回收站加载失败，请重试', color: 'error' })
    }
  } finally {
    if (epoch === loadGeneration) trashLoading.value = false
  }
}
watch(page, loadTrashDocuments)

// Load document preview
const loadDocumentPreview = async (doc: ProjectDocument) => {
  const epoch = ++previewGeneration
  previewController?.abort()
  previewController = new AbortController()
  selectedDoc.value = doc
  previewLoading.value = true
  previewContent.value = ''

  try {
    const response = await $fetch<{ success: boolean, data: DocumentPreviewData }>(moduleUrl(`/api/documents/${doc.uuid}?include_deleted=1`), { signal: previewController.signal })
    if (epoch !== previewGeneration) return
    if (response.success && response.data) {
      previewContent.value = response.data.content || ''
    }
  } catch {
    if (epoch !== previewGeneration) return
    toast.add({
      title: '加载失败',
      description: '无法加载文档内容',
      color: 'error'
    })
  } finally {
    if (epoch === previewGeneration) previewLoading.value = false
  }
}

// Convert ProjectDocument to RestoreDocRecord
const toRestoreRecord = (doc: ProjectDocument | null): RestoreDocRecord | null => {
  if (!doc) return null
  return {
    uuid: doc.uuid || '',
    title: doc.title,
    doc_type: doc.docType || String(doc['doc_type'] || 'private'),
    owner_uid: doc.ownerUid,
    folder_id: doc.folderId,
    project_code: String(doc.projectCode || '')
  }
}

// Select document
const selectDocument = (doc: ProjectDocument) => {
  loadDocumentPreview(doc)
}

// Back to list
const backToList = () => {
  previewGeneration++
  previewController?.abort()
  previewLoading.value = false
  selectedDoc.value = null
  previewContent.value = ''
}

// On restore success
const onRestored = () => {
  showRestoreModal.value = false
  // If restored doc is currently previewed, go back to list
  if (selectedDoc.value?.uuid === restoreDoc.value?.uuid) {
    backToList()
  }
  restoreDoc.value = null
  loadTrashDocuments()
}

// Initialize
onMounted(() => {
  loadTrashDocuments()
})

watch(() => cacheKey('recycle-page'), () => {
  loadGeneration++
  trashController?.abort()
  trashDocuments.value = []
  total.value = 0
  backToList()
  showRestoreModal.value = false
  restoreDoc.value = null
  if (page.value !== 1) page.value = 1
  else if (user.value) void loadTrashDocuments()
}, { flush: 'sync' })
</script>

<template>
  <UDashboardPanel grow>
    <div class="px-4 pt-4 sm:px-6 sm:pt-6">
      <ContentPageHeader
        :hosted="hosted"
        title="回收站"
        description="查看并恢复已删除的文档。"
        breadcrumb="文档 / 文档空间"
      />
    </div>
    <div class="flex flex-1 overflow-hidden">
      <!-- Left: Trash Document List -->
      <aside class="w-60 border-r border-default bg-default flex flex-col overflow-y-auto">
        <div class="flex-1 p-2">
          <div v-if="trashLoading" class="px-2 py-4 text-sm text-muted text-center">
            加载中...
          </div>
          <div
            v-else-if="trashDocuments.length === 0"
            class="flex flex-col items-center justify-center py-12"
          >
            <UIcon name="i-lucide-trash-2" class="w-12 h-12 text-muted mb-3" />
            <p class="text-sm text-muted">
              回收站为空
            </p>
          </div>
          <div v-else class="space-y-0.5">
            <div
              v-for="doc in trashDocuments"
              :key="doc.uuid || doc.id"
              class="group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-elevated transition-colors"
              :class="{ 'bg-primary/10 text-secondary font-medium': selectedDoc?.uuid === doc.uuid }"
              @click="selectDocument(doc)"
            >
              <UIcon name="i-lucide-file-x-2" class="w-4 h-4 shrink-0 text-dimmed" />
              <div class="min-w-0 flex-1">
                <p class="text-sm truncate">
                  {{ doc.title }}
                </p>
                <p class="text-xs text-muted truncate">
                  {{ formatDeletedAt(String(doc.deletedAt || '')) }}
                </p>
              </div>
            </div>
          </div>
        </div>
        <div class="border-t border-default p-2 space-y-2">
          <p class="text-sm text-muted">
            共 {{ total }} 条
          </p>
          <UPagination
            v-model:page="page"
            :items-per-page="pageSize"
            :total="total"
            :sibling-count="0"
            size="xs"
          />
        </div>
      </aside>

      <!-- Right: Preview Panel -->
      <main class="flex-1 flex flex-col overflow-hidden bg-default">
        <!-- Toolbar -->
        <div
          v-if="selectedDoc"
          class="flex items-center justify-between px-4 py-3 border-b border-default bg-default"
        >
          <div class="flex flex-col gap-1 min-w-0 flex-1">
            <div class="flex items-center gap-2 min-w-0">
              <UIcon name="i-lucide-file-x-2" class="w-5 h-5 text-dimmed shrink-0" />
              <span class="font-medium truncate">{{ selectedDoc.title }}</span>
              <span v-if="selectedDoc.deleted_at" class="text-xs text-muted shrink-0">
                ({{ formatDeletedAt(String(selectedDoc.deleted_at)) }})
              </span>
            </div>
            <div class="flex items-center gap-1 text-xs text-muted pl-7">
              <UIcon name="i-lucide-folder" class="w-3.5 h-3.5" />
              <span>{{ formatDocLocation(selectedDoc) }}</span>
            </div>
          </div>
          <UButton
            icon="i-lucide-archive-restore"
            size="sm"
            color="primary"
            @click="restoreDoc = toRestoreRecord(selectedDoc); showRestoreModal = true"
          >
            恢复
          </UButton>
        </div>

        <!-- Preview Content -->
        <div class="flex-1 overflow-auto p-4">
          <!-- Empty state -->
          <div v-if="!selectedDoc" class="h-full flex items-center justify-center">
            <div class="flex flex-col items-center gap-4">
              <UIcon name="i-lucide-trash-2" class="w-16 h-16 text-muted" />
              <div class="text-center">
                <h3 class="text-xl font-semibold text-default mb-2">
                  回收站
                </h3>
                <p class="text-sm text-muted">
                  {{ trashDocuments.length > 0 ? '选择文档进行预览' : '回收站中暂无文档' }}
                </p>
                <p class="text-xs text-muted mt-2">
                  文档将在删除{{ useRuntimeConfig().public.recycleDays }}天后自动清理
                </p>
              </div>
            </div>
          </div>

          <!-- Document preview -->
          <div
            v-else
            class="max-w-4xl mx-auto bg-default shadow-sm rounded-lg min-h-full p-0 relative"
          >
            <div
              v-if="previewLoading"
              class="absolute inset-0 flex items-center justify-center bg-default/80 z-10"
            >
              <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary" />
            </div>
            <EditorMilkdownEditor
              v-if="previewContent && !previewLoading"
              :model-value="previewContent"
              :show-sidebar="false"
              readonly
            />
          </div>
        </div>
      </main>
    </div>

    <!-- Restore Modal -->
    <RestoreDocumentModal
      :open="showRestoreModal"
      :doc="restoreDoc"
      @update:open="showRestoreModal = $event"
      @restored="onRestored"
    />
  </UDashboardPanel>
</template>
