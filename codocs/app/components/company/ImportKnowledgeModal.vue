<script setup lang="ts">
import type { Department } from '~/types/account'

interface SourceFolder {
  id: number
  name: string
  parent_id: number | null
  dept_code: string | null
  sort_order: number
}

interface SourceDocument {
  id: number
  uuid: string
  title: string
  doc_type: string
  oss_path: string
  owner_uid: string
  dept_code: string | null
  folder_id: number | null
  content_size: number | null
  updated_at: string
  readonly_flag: number
  publish_info: string | null
}

interface ImportSourceResponse {
  code: number
  data: {
    departments?: {
      tree?: Department[]
      flat?: Department[]
    }
    folders?: SourceFolder[]
    documents?: SourceDocument[]
  }
}

interface ImportResponse {
  code: number
  data: {
    imported?: Array<{ sourceUuid: string, title: string, newUuid: string, ossPath: string }>
    skipped?: Array<{ sourceUuid: string, title: string, reason: string }>
  }
}

interface FetchErrorLike {
  data?: { message?: string }
  message?: string
}

const props = defineProps<{
  open: boolean
  targetPath: string
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'imported': []
}>()

const toast = useToast()

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const departments = ref<Department[]>([])
const folders = ref<SourceFolder[]>([])
const documents = ref<SourceDocument[]>([])
const selectedDeptCode = ref('')
const selectedFolderId = ref<number | null>(null)
const selectedDocumentUuids = ref<string[]>([])
const loading = ref(false)
const importing = ref(false)
const deptSearch = ref('')

const targetLabel = computed(() => props.targetPath ? `/${props.targetPath}` : '/')

const flattenDepartments = (nodes: Department[], level = 0): Array<Department & { level: number }> => {
  return nodes.flatMap(node => [
    { ...node, level },
    ...flattenDepartments(node.children || [], level + 1)
  ])
}

const departmentRows = computed(() => {
  const keyword = deptSearch.value.trim().toLowerCase()
  const rows = flattenDepartments(departments.value)
  if (!keyword) return rows
  return rows.filter(dept =>
    dept.name.toLowerCase().includes(keyword)
    || dept.deptCode.toLowerCase().includes(keyword)
  )
})

const folderRows = computed(() => {
  const byParent = new Map<number | null, SourceFolder[]>()
  folders.value.forEach((folder) => {
    const parentId = folder.parent_id ?? null
    const list = byParent.get(parentId) || []
    list.push(folder)
    byParent.set(parentId, list)
  })

  const visit = (parentId: number | null, level: number): Array<SourceFolder & { level: number }> => {
    const children = (byParent.get(parentId) || [])
      .slice()
      .sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name, 'zh-CN'))

    return children.flatMap(folder => [
      { ...folder, level },
      ...visit(folder.id, level + 1)
    ])
  }

  return visit(null, 0)
})

const selectedCount = computed(() => selectedDocumentUuids.value.length)
const allDocumentsSelected = computed(() =>
  documents.value.length > 0 && documents.value.every(doc => selectedDocumentUuids.value.includes(doc.uuid))
)

const selectedDeptName = computed(() =>
  flattenDepartments(departments.value).find(dept => dept.deptCode === selectedDeptCode.value)?.name || ''
)

const selectedFolderName = computed(() => {
  if (selectedFolderId.value === null) return selectedDeptName.value
  return folders.value.find(folder => folder.id === selectedFolderId.value)?.name || selectedDeptName.value
})

const loadSource = async (deptCode = selectedDeptCode.value, folderId = selectedFolderId.value) => {
  loading.value = true
  try {
    const res = await $fetch<ImportSourceResponse>('/api/company-assets/import-source', {
      params: {
        deptCode: deptCode || undefined,
        folderId: folderId ?? undefined
      }
    })

    departments.value = res.data.departments?.tree || departments.value
    folders.value = res.data.folders || []
    documents.value = res.data.documents || []
    selectedDocumentUuids.value = []
  } catch (error: unknown) {
    const err = error as FetchErrorLike
    toast.add({
      title: '加载导入源失败',
      description: err.data?.message || err.message,
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}

watch(() => props.open, async (open) => {
  if (!open) return
  selectedDeptCode.value = ''
  selectedFolderId.value = null
  selectedDocumentUuids.value = []
  folders.value = []
  documents.value = []
  deptSearch.value = ''
  await loadSource('', null)
}, { immediate: false })

const selectDepartment = async (dept: Department) => {
  selectedDeptCode.value = dept.deptCode
  selectedFolderId.value = null
  await loadSource(dept.deptCode, null)
}

const selectFolder = async (folder: SourceFolder) => {
  selectedFolderId.value = folder.id
  await loadSource(selectedDeptCode.value, folder.id)
}

const toggleDocument = (uuid: string) => {
  selectedDocumentUuids.value = selectedDocumentUuids.value.includes(uuid)
    ? selectedDocumentUuids.value.filter(item => item !== uuid)
    : [...selectedDocumentUuids.value, uuid]
}

const toggleAllDocuments = () => {
  selectedDocumentUuids.value = allDocumentsSelected.value
    ? []
    : documents.value.map(doc => doc.uuid)
}

const formatDate = (value: string) => {
  if (!value) return ''
  return new Date(value).toLocaleDateString()
}

const importDocuments = async () => {
  if (!selectedDocumentUuids.value.length) return

  importing.value = true
  try {
    const res = await $fetch<ImportResponse>('/api/company-assets/import-documents', {
      method: 'POST',
      body: {
        subdir: 'knowledge',
        targetPath: props.targetPath || undefined,
        documentUuids: selectedDocumentUuids.value
      }
    })

    const importedCount = res.data.imported?.length || 0
    const skippedCount = res.data.skipped?.length || 0
    toast.add({
      title: skippedCount ? `已导入 ${importedCount} 个，跳过 ${skippedCount} 个` : `已导入 ${importedCount} 个文档`,
      color: importedCount > 0 ? 'success' : 'warning'
    })

    emit('imported')
    if (importedCount > 0) {
      isOpen.value = false
    } else {
      selectedDocumentUuids.value = []
      await loadSource()
    }
  } catch (error: unknown) {
    const err = error as FetchErrorLike
    toast.add({
      title: '导入失败',
      description: err.data?.message || err.message,
      color: 'error'
    })
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    title="导入文档"
    :description="`目标目录：${targetLabel}`"
    :ui="{ content: 'sm:max-w-6xl w-[min(96vw,72rem)] max-h-[min(88vh,46rem)] overflow-hidden', body: 'p-0', footer: 'justify-between' }"
  >
    <template #body>
      <div class="grid grid-cols-[20rem_minmax(0,1fr)] h-[min(68vh,34rem)]">
        <aside class="border-r border-default flex flex-col min-h-0">
          <div class="p-3 border-b border-default">
            <UInput
              v-model="deptSearch"
              icon="i-lucide-search"
              placeholder="搜索部门"
              size="sm"
            />
          </div>
          <div class="flex-1 overflow-y-auto p-2">
            <div v-if="loading && departments.length === 0" class="text-sm text-muted text-center py-6">
              加载中...
            </div>
            <div v-else-if="departmentRows.length === 0" class="text-sm text-muted text-center py-6">
              暂无部门
            </div>
            <template v-else>
              <div v-for="dept in departmentRows" :key="dept.deptCode">
                <button
                  type="button"
                  class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm hover:bg-elevated"
                  :class="{ 'bg-primary/10 text-primary font-medium': selectedDeptCode === dept.deptCode && selectedFolderId === null }"
                  :style="{ paddingLeft: `${dept.level * 14 + 8}px` }"
                  @click="selectDepartment(dept)"
                >
                  <UIcon name="i-lucide-building-2" class="w-4 h-4 shrink-0 text-gray-500" />
                  <span class="truncate">{{ dept.name }}</span>
                </button>

                <div v-if="selectedDeptCode === dept.deptCode" class="mt-1 mb-1">
                  <button
                    type="button"
                    class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm hover:bg-elevated"
                    :class="{ 'bg-primary/10 text-primary font-medium': selectedFolderId === null }"
                    :style="{ paddingLeft: `${dept.level * 14 + 28}px` }"
                    @click="selectDepartment(dept)"
                  >
                    <UIcon name="i-lucide-folder-open" class="w-4 h-4 shrink-0 text-amber-500" />
                    <span class="truncate">/</span>
                  </button>
                  <button
                    v-for="folder in folderRows"
                    :key="folder.id"
                    type="button"
                    class="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm hover:bg-elevated"
                    :class="{ 'bg-primary/10 text-primary font-medium': selectedFolderId === folder.id }"
                    :style="{ paddingLeft: `${dept.level * 14 + folder.level * 14 + 28}px` }"
                    @click="selectFolder(folder)"
                  >
                    <UIcon name="i-lucide-folder" class="w-4 h-4 shrink-0 text-amber-500" />
                    <span class="truncate">{{ folder.name }}</span>
                  </button>
                </div>
              </div>
            </template>
          </div>
        </aside>

        <section class="flex flex-col min-h-0">
          <div class="flex items-center justify-between px-4 py-3 border-b border-default">
            <div class="min-w-0">
              <div class="font-medium truncate">
                {{ selectedFolderName || '请选择部门' }}
              </div>
              <div class="text-xs text-muted">
                {{ documents.length }} 个文档
              </div>
            </div>
            <UButton
              size="sm"
              icon="i-lucide-refresh-cw"
              variant="ghost"
              color="neutral"
              :loading="loading"
              @click="loadSource()"
            >
              刷新
            </UButton>
          </div>

          <div class="grid grid-cols-[2.5rem_minmax(0,1fr)_7rem_7rem] gap-3 px-4 py-2.5 border-b border-default text-xs font-medium text-muted bg-elevated/50">
            <div>
              <input
                type="checkbox"
                :checked="allDocumentsSelected"
                :disabled="documents.length === 0"
                class="rounded border-gray-300 disabled:opacity-40"
                @change="toggleAllDocuments"
              >
            </div>
            <div>文档</div>
            <div>大小</div>
            <div>更新时间</div>
          </div>

          <div class="flex-1 overflow-y-auto">
            <div v-if="loading && selectedDeptCode" class="flex items-center justify-center h-full text-muted">
              <UIcon name="i-lucide-loader-2" class="w-5 h-5 animate-spin mr-2" />
              加载中...
            </div>
            <div v-else-if="!selectedDeptCode" class="flex items-center justify-center h-full text-muted">
              请选择部门或目录
            </div>
            <div v-else-if="documents.length === 0" class="flex items-center justify-center h-full text-muted">
              当前目录暂无文档
            </div>
            <template v-else>
              <div
                v-for="doc in documents"
                :key="doc.uuid"
                class="grid grid-cols-[2.5rem_minmax(0,1fr)_7rem_7rem] gap-3 px-4 py-3 border-b border-default/70 items-center hover:bg-elevated/60 text-sm"
              >
                <div>
                  <input
                    type="checkbox"
                    :checked="selectedDocumentUuids.includes(doc.uuid)"
                    class="rounded border-gray-300"
                    @change="toggleDocument(doc.uuid)"
                  >
                </div>
                <div class="min-w-0">
                  <div class="font-medium truncate">
                    {{ doc.title }}
                  </div>
                  <div class="text-xs text-muted truncate">
                    {{ doc.owner_uid }}
                  </div>
                </div>
                <div class="text-xs text-muted">
                  {{ Math.ceil((doc.content_size || 0) / 1024) }} KB
                </div>
                <div class="text-xs text-muted">
                  {{ formatDate(doc.updated_at) }}
                </div>
              </div>
            </template>
          </div>
        </section>
      </div>
    </template>

    <template #footer>
      <div class="text-sm text-muted">
        已选 {{ selectedCount }} 个
      </div>
      <div class="flex justify-end gap-2">
        <UButton variant="outline" color="neutral" @click="isOpen = false">
          取消
        </UButton>
        <UButton
          color="primary"
          icon="i-lucide-upload"
          :disabled="selectedCount === 0"
          :loading="importing"
          @click="importDocuments"
        >
          导入公司知识库
        </UButton>
      </div>
    </template>
  </UModal>
</template>
