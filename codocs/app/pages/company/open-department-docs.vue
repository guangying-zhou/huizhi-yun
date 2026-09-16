<script setup lang="ts">
import type { ProjectDocsTreeItem } from '~/types'

interface OpenDepartmentDocument {
  uuid: string
  title: string
  dept_code?: string | null
  folder_id?: number | null
  owner_uid?: string
  updated_at?: string
  content?: string
  ai_abstract?: string | null
  [key: string]: unknown
}

interface OpenDepartmentFolder {
  id: number
  name: string
  dept_code?: string | null
  parent_id?: number | null
  is_open?: number | boolean | null
  children: OpenDepartmentFolder[]
  documents: OpenDepartmentDocument[]
  [key: string]: unknown
}

interface OpenDepartmentGroup {
  deptCode: string
  deptName: string
  documentCount: number
  folders: OpenDepartmentFolder[]
}

interface OpenDepartmentDocsResponse {
  success: boolean
  data: {
    departments: OpenDepartmentGroup[]
  }
}

definePageMeta({
  layout: 'default'
})

usePageTitle('部门开放文档')

const toast = useToast()
const { panelWidth, panelCollapsed, onResizeStart, showPanel } = useResizablePanel(288)
const { setHeaderActions, clearHeaderActions } = useLayoutHeaderActions()

const selectedDeptCode = ref('')
const selectedNodeId = ref('')
const selectedNodeType = ref<'folder' | 'document' | null>(null)
const expandedFolders = ref<Set<number>>(new Set())
const showMobileSidebar = ref(false)
const previewDoc = ref<OpenDepartmentDocument | null>(null)
const previewContent = ref('')
const previewAbstract = ref('')
const previewLoading = ref(false)

const { data, pending, refresh } = await useAsyncData(
  'open-department-docs',
  async () => {
    const response = await $fetch<OpenDepartmentDocsResponse>('/api/open-department-docs')
    return response.data.departments || []
  },
  {
    getCachedData: () => undefined
  }
)

const departmentGroups = computed(() => data.value || [])
const departmentOptions = computed(() => departmentGroups.value.map(group => ({
  label: group.deptName,
  value: group.deptCode,
  description: `${group.documentCount} 个文档`
})))

const selectedGroup = computed(() =>
  departmentGroups.value.find(group => group.deptCode === selectedDeptCode.value) || departmentGroups.value[0] || null
)

watch(departmentGroups, (groups) => {
  if (!groups.length) {
    selectedDeptCode.value = ''
    return
  }
  if (!groups.some(group => group.deptCode === selectedDeptCode.value)) {
    selectedDeptCode.value = groups[0]?.deptCode || ''
  }
}, { immediate: true })

watch(selectedGroup, (group) => {
  selectedNodeId.value = ''
  selectedNodeType.value = null
  previewDoc.value = null
  previewContent.value = ''
  previewAbstract.value = ''
  expandedFolders.value = new Set((group?.folders || []).map(folder => folder.id))
})

const folderToTreeItem = (folder: OpenDepartmentFolder): ProjectDocsTreeItem => ({
  type: 'folder',
  id: folder.id,
  nodeId: `folder-${folder.id}`,
  name: folder.name,
  data: folder,
  children: [
    ...folder.children.map(folderToTreeItem),
    ...folder.documents.map(doc => ({
      type: 'document' as const,
      id: doc.uuid,
      nodeId: `doc-${doc.uuid}`,
      name: doc.title || '未命名文档',
      data: doc
    }))
  ]
})

const treeItems = computed<ProjectDocsTreeItem[]>(() =>
  (selectedGroup.value?.folders || []).map(folderToTreeItem)
)

const toggleFolder = (folderId: number) => {
  if (expandedFolders.value.has(folderId)) {
    expandedFolders.value.delete(folderId)
  } else {
    expandedFolders.value.add(folderId)
  }
  expandedFolders.value = new Set(expandedFolders.value)
}

const selectNode = async (nodeId: string, nodeType: 'folder' | 'document', raw?: Record<string, unknown>) => {
  selectedNodeId.value = nodeId
  selectedNodeType.value = nodeType
  showMobileSidebar.value = false

  if (nodeType === 'folder') {
    previewDoc.value = null
    previewContent.value = ''
    previewAbstract.value = ''
    return
  }

  const doc = raw as OpenDepartmentDocument
  previewDoc.value = doc
  previewLoading.value = true
  previewContent.value = ''
  previewAbstract.value = ''

  try {
    const response = await $fetch<{ success: boolean, data: OpenDepartmentDocument }>(`/api/open-department-docs/${encodeURIComponent(doc.uuid)}`)
    previewDoc.value = response.data
    previewContent.value = response.data.content || ''
    previewAbstract.value = String(response.data.ai_abstract || '')
  } catch (error: unknown) {
    const err = error as { data?: { message?: string }, message?: string }
    toast.add({
      title: '加载失败',
      description: err.data?.message || err.message || '无法加载开放文档',
      color: 'error'
    })
  } finally {
    previewLoading.value = false
  }
}

const selectedFolderName = computed(() => {
  if (selectedNodeType.value !== 'folder') return ''
  const findFolder = (folders: OpenDepartmentFolder[]): OpenDepartmentFolder | null => {
    for (const folder of folders) {
      if (`folder-${folder.id}` === selectedNodeId.value) return folder
      const child = findFolder(folder.children || [])
      if (child) return child
    }
    return null
  }
  return findFolder(selectedGroup.value?.folders || [])?.name || ''
})

const refreshPage = async () => {
  await refresh()
}

onMounted(() => {
  setHeaderActions([
    {
      key: 'open-department-docs-mobile-directory',
      icon: 'i-lucide-folder-tree',
      ariaLabel: '打开目录',
      title: '目录',
      color: 'primary',
      variant: 'soft',
      size: 'sm',
      square: true,
      class: 'md:hidden',
      onClick: () => {
        showMobileSidebar.value = true
      }
    }
  ])
})

onUnmounted(() => {
  clearHeaderActions()
})
</script>

<template>
  <UDashboardPanel grow>
    <div v-if="panelCollapsed" class="hidden md:flex items-center gap-2 px-3 py-1 border-b border-default">
      <UButton
        icon="i-lucide-folder-tree"
        variant="ghost"
        size="sm"
        @click="showPanel"
      >
        目录
      </UButton>
      <div class="flex-1" />
      <UButton
        icon="i-lucide-refresh-cw"
        variant="ghost"
        size="sm"
        @click="refreshPage"
      />
    </div>

    <div class="flex flex-1 overflow-hidden relative">
      <div
        v-if="showMobileSidebar"
        class="absolute inset-0 bg-black/50 dark:bg-black/80 z-20 md:hidden"
        @click="showMobileSidebar = false"
      />

      <aside
        v-if="!panelCollapsed"
        class="absolute md:relative inset-y-0 left-0 z-30 border-r border-default bg-default flex flex-col overflow-y-auto transform transition-transform duration-200"
        :class="[showMobileSidebar ? 'translate-x-0' : '-translate-x-full md:translate-x-0']"
        :style="{ width: panelWidth + 'px' }"
      >
        <div class="p-3 border-b border-default">
          <div class="flex items-center gap-2 mb-3">
            <div class="min-w-0">
              <p class="text-xs text-muted truncate">
                选择部门
              </p>
            </div>
          </div>

          <USelectMenu
            v-if="departmentOptions.length > 1"
            v-model="selectedDeptCode"
            :items="departmentOptions"
            label-key="label"
            value-key="value"
            placeholder="选择部门"
            class="w-full"
            :search-input="false"
          />
          <div v-else-if="selectedGroup" class="flex items-center gap-2 text-sm">
            <UIcon name="i-lucide-building-2" class="w-4 h-4 text-muted" />
            <span class="truncate">{{ selectedGroup.deptName }}</span>
          </div>
        </div>

        <div class="flex-1 p-2">
          <div v-if="pending" class="px-2 py-4 text-sm text-muted text-center">
            加载中...
          </div>
          <div v-else-if="departmentGroups.length === 0" class="px-2 py-4 text-sm text-muted text-center">
            暂无开放文档
          </div>
          <div v-else-if="treeItems.length === 0" class="px-2 py-4 text-sm text-muted text-center">
            当前部门暂无开放文档
          </div>
          <FileTreeItem
            v-for="item in treeItems"
            v-else
            :key="item.id"
            :item="item"
            :selected-id="selectedNodeId"
            :expanded-ids="expandedFolders"
            :editing-id="null"
            editing-name=""
            :can-mutate="false"
            :can-delete="false"
            :can-manage-open="false"
            :show-open-indicator="false"
            @select="(id: string, type: 'folder' | 'document', itemData: Record<string, unknown>) => selectNode(id, type, itemData)"
            @toggle="toggleFolder"
            @start-edit="() => {}"
            @save-edit="() => {}"
            @cancel-edit="() => {}"
            @delete="() => {}"
            @toggle-open="() => {}"
            @update:editing-name="() => {}"
          />
        </div>
      </aside>

      <div
        v-if="!panelCollapsed"
        class="hidden md:block w-1.5 shrink-0 cursor-col-resize bg-default hover:bg-primary/40 active:bg-primary/60 transition-colors z-10 -ml-px"
        @mousedown.prevent="onResizeStart"
      />

      <main class="flex-1 flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-950">
        <div
          v-if="previewDoc"
          class="flex items-center justify-between px-4 py-3 border-b border-default bg-default"
        >
          <div class="flex items-center gap-2 min-w-0">
            <UIcon name="i-lucide-file-text" class="w-5 h-5 text-gray-500 shrink-0" />
            <span class="font-medium truncate">{{ previewDoc.title }}</span>
          </div>
          <UBadge color="primary" variant="subtle">
            只读
          </UBadge>
        </div>

        <div class="flex-1 overflow-auto p-4">
          <div v-if="!selectedNodeType" class="h-full flex items-center justify-center">
            <div class="text-center text-muted">
              <UIcon name="i-lucide-file-search" class="w-16 h-16 mx-auto mb-4" />
              <p>选择左侧开放文档进行查看</p>
            </div>
          </div>
          <div v-else-if="selectedNodeType === 'folder'" class="h-full flex items-center justify-center">
            <div class="text-center text-muted">
              <UIcon name="i-lucide-folder-open" class="w-16 h-16 mx-auto mb-4 text-primary" />
              <p class="font-medium text-default">
                {{ selectedFolderName || '开放目录' }}
              </p>
              <p class="text-sm mt-1">
                从左侧选择文档进行查看
              </p>
            </div>
          </div>
          <div v-else-if="previewLoading" class="h-full flex items-center justify-center">
            <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary" />
          </div>
          <div v-else class="max-w-4xl mx-auto bg-white dark:bg-gray-900 shadow-sm rounded-lg min-h-full">
            <div
              v-if="previewAbstract"
              class="border-b border-primary-200 dark:border-primary-800 bg-primary-50 dark:bg-primary-900/20 px-4 py-2.5 rounded-t-lg"
            >
              <div class="flex items-start gap-2">
                <UIcon name="i-lucide-sparkles" class="w-4 h-4 text-primary mt-0.5 shrink-0" />
                <div>
                  <span class="text-xs font-medium text-primary">AI 摘要</span>
                  <p class="text-sm text-gray-700 dark:text-gray-300 leading-relaxed mt-0.5">
                    {{ previewAbstract }}
                  </p>
                </div>
              </div>
            </div>
            <EditorDocLazyPreview
              v-if="previewContent"
              :content="previewContent"
            />
            <div v-else class="p-8 text-center text-muted">
              无法预览此文档
            </div>
          </div>
        </div>
      </main>
    </div>
  </UDashboardPanel>
</template>
