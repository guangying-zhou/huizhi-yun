<script setup lang="ts">
import type { ProjectDocument } from '~/types'

definePageMeta({
  layout: 'default'
})

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
const uid = computed(() => user.value || 'user1')

usePageTitle('回收站')

const { fetchTrashDocuments: fetchTrash, formatDeletedAt, formatDocLocation } = useRecycleBin()

// State
const trashDocuments = ref<ProjectDocument[]>([])
const trashLoading = ref(false)

// Preview state
const selectedDoc = ref<ProjectDocument | null>(null)
const previewContent = ref('')
const previewLoading = ref(false)

// Restore modal state
const showRestoreModal = ref(false)
const restoreDoc = ref<RestoreDocRecord | null>(null)

// Load trash documents
const loadTrashDocuments = async () => {
  trashLoading.value = true
  try {
    trashDocuments.value = await fetchTrash({
      type: 'private',
      owner: uid.value
    })
  } finally {
    trashLoading.value = false
  }
}

// Load document preview
const loadDocumentPreview = async (doc: ProjectDocument) => {
  selectedDoc.value = doc
  previewLoading.value = true
  previewContent.value = ''

  try {
    const response = await $fetch<{ success: boolean, data: DocumentPreviewData }>(`/api/documents/${doc.uuid}?include_deleted=1`)
    if (response.success && response.data) {
      previewContent.value = response.data.content || ''
    }
  } catch {
    toast.add({
      title: '加载失败',
      description: '无法加载文档内容',
      color: 'error'
    })
  } finally {
    previewLoading.value = false
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

watch(user, (newUser) => {
  if (newUser) loadTrashDocuments()
})
</script>

<template>
  <UDashboardPanel grow>
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
              <UIcon name="i-lucide-file-x-2" class="w-4 h-4 shrink-0 text-gray-400" />
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
      </aside>

      <!-- Right: Preview Panel -->
      <main class="flex-1 flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
        <!-- Toolbar -->
        <div
          v-if="selectedDoc"
          class="flex items-center justify-between px-4 py-3 border-b border-default bg-default"
        >
          <div class="flex flex-col gap-1 min-w-0 flex-1">
            <div class="flex items-center gap-2 min-w-0">
              <UIcon name="i-lucide-file-x-2" class="w-5 h-5 text-gray-400 shrink-0" />
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
            class="max-w-4xl mx-auto bg-white dark:bg-gray-900 shadow-sm rounded-lg min-h-full p-0 relative"
          >
            <div
              v-if="previewLoading"
              class="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 z-10"
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
