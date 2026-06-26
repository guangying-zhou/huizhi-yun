<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ProjectFileItem } from '~/types'
import type { Project } from '~/types/account'
import GroupFileTreeItem from './GroupFileTreeItem.vue'

interface Props {
  project: Project
  isSelected: boolean
  isManaged: boolean
  managedProjectCodes?: string[]
  selectedNodeId: string
  docsLoading?: boolean
  level?: number
  isExpanded?: boolean
  onlyGroup?: boolean
  showRecycleBin?: boolean
  trashDocuments?: Record<string, unknown>[]
  trashLoading?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  docsLoading: false,
  managedProjectCodes: () => [],
  level: 0,
  isExpanded: false,
  onlyGroup: false,
  showRecycleBin: false,
  trashDocuments: () => [],
  trashLoading: false
})

const emit = defineEmits<{
  select: [nodeId: string, nodeType: 'project' | 'folder' | 'document', data: Project | ProjectFileItem | Record<string, unknown>, project?: Project]
  toggle: [data: Project]
  delete: [type: 'project' | 'folder' | 'document', nodeId: string | number, name: string]
  restore: [doc: Record<string, unknown>]
  renamed: []
}>()

const toast = useToast()

// State for GroupFileTreeItem
const expandedFolderIds = ref(new Set<number>())
const editingId = ref<string | null>(null)
const editingName = ref('')

const handleFolderToggle = (folderId: number) => {
  const newSet = new Set(expandedFolderIds.value)
  if (newSet.has(folderId)) {
    newSet.delete(folderId)
  } else {
    newSet.add(folderId)
  }
  expandedFolderIds.value = newSet
}

// Inline editing handlers
const startEdit = (id: string, name: string) => {
  editingId.value = id
  editingName.value = name
}

const saveEdit = async () => {
  if (!editingId.value || !editingName.value.trim()) {
    editingId.value = null
    return
  }

  try {
    if (editingId.value.startsWith('folder-')) {
      const folderId = parseInt(editingId.value.replace('folder-', ''))
      await $fetch(`/api/folders/${folderId}`, {
        method: 'PATCH',
        body: { name: editingName.value.trim() }
      })
      toast.add({ title: '文件夹已重命名', color: 'success' })
    } else if (editingId.value.startsWith('doc-')) {
      const docUuid = editingId.value.replace('doc-', '')
      await $fetch(`/api/documents/${docUuid}`, {
        method: 'PATCH',
        body: { title: editingName.value.trim() }
      })
      toast.add({ title: '文档已重命名', color: 'success' })
    }
    emit('renamed')
  } catch (err: unknown) {
    toast.add({ title: err instanceof Error ? err.message : '重命名失败', color: 'error' })
  } finally {
    editingId.value = null
  }
}

const cancelEdit = () => {
  editingId.value = null
  editingName.value = ''
}

// Calculate left padding based on nesting level
const paddingLeft = computed(() => `${props.level * 16}px`)
const currentIsManaged = computed(() => props.isManaged || props.managedProjectCodes.includes(props.project.projectCode))
const isProjectManaged = (project: Project) => props.managedProjectCodes.includes(project.projectCode)

// 导入 formatDeletedAt 函数
const { formatDeletedAt } = useRecycleBin()

// 计算当前项目的回收站文档
const currentProjectTrashDocs = computed(() => {
  if (!props.showRecycleBin || !props.trashDocuments || !Array.isArray(props.trashDocuments)) {
    return []
  }
  if (!props.project || !props.project.projectCode) {
    return []
  }
  return props.trashDocuments.filter(doc => doc && doc.project_code === props.project.projectCode)
})
</script>

<template>
  <div v-if="!(props.onlyGroup && props.project.isGroup !== 1)" class="space-y-0.5">
    <!-- Project Node -->
    <div
      class="group flex items-center justify-between gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-elevated"
      :class="{
        'bg-primary/10 text-primary font-medium': isSelected,
        'bg-primary/5 text-primary dark:bg-primary/10': !isSelected && currentIsManaged
      }"
      :style="{ paddingLeft }"
      @click="$emit('select', `project-${props.project.projectCode}`, 'project', props.project)"
    >
      <div class="flex items-center min-w-0 flex-1">
        <UIcon
          :name="props.project.isGroup ? 'i-lucide-folder-tree' : 'i-lucide-folder-git-2'"
          class="w-3.5 h-3.5 shrink-0 mr-2"
        />
        <UTooltip :text="props.project.name" :ui="{ content: 'text-md' }">
          <span class="text-md truncate">{{ props.project.name }}</span>
        </UTooltip>
      </div>
      <UBadge
        v-if="currentIsManaged"
        size="xs"
        color="primary"
        variant="soft"
        class="shrink-0"
      >
        我管理
      </UBadge>
      <span class="cursor-pointer shrink-0" @click.stop="$emit('toggle', props.project)">
        <UIcon
          :name="props.project.isExpanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          class="w-3.5 h-3.5 block"
        />
      </span>
    </div>

    <!-- Expanded content -->
    <template v-if="!props.onlyGroup && props.project.isExpanded">
      <!-- Sub-git_projects (nested git_projects) -->
      <template v-if="props.project.subProjects && props.project.subProjects.length > 0">
        <ProjectTreeItem
          v-for="subProject in props.project.subProjects"
          :key="subProject.projectCode"
          :project="subProject"
          :is-selected="selectedNodeId === `project-${subProject.projectCode}`"
          :is-managed="isProjectManaged(subProject)"
          :managed-project-codes="props.managedProjectCodes"
          :selected-node-id="selectedNodeId"
          :is-expanded="subProject.isExpanded"
          :level="level + 1"
          :docs-loading="docsLoading"
          @toggle="$emit('toggle', subProject)"
          @select="(id: string, type: 'project' | 'folder' | 'document', data: Project | ProjectFileItem | Record<string, unknown>, p?: Project) => $emit('select', id, type, data, p || subProject)"
        />
      </template>

      <div
        v-if="(!props.project.isGroup || (props.project.repoUrl && props.project.docsSyncedAt)) && props.project.isExpanded"
      >
        <div
          v-if="props.docsLoading || props.project.docsLoading"
          class="px-2 py-2 text-xs text-muted"
          :style="{ marginLeft: `${(level + 1) * 16}px` }"
        >
          正在加载...
        </div>
        <!-- Document Tree -->
        <div v-else-if="props.project.documents && props.project.documents.length > 0" class="space-y-0.5">
          <div
            v-for="item in props.project.documents"
            :key="item.uuid"
            class="group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-elevated"
            :class="{ 'bg-primary/10 text-primary': selectedNodeId === item.uuid }"
            :style="{ paddingLeft: `${(level + 1) * 16}px` }"
            @click.stop="$emit('select', item.uuid, 'document', item, props.project)"
          >
            <!-- Padding to align with folder text (chevron width + gap) -->
            <!-- Alternatively, use indentation directly -->
            <UIcon name="i-lucide-file-text" class="w-4 h-4 shrink-0" />
            <UTooltip :text="item.name" :ui="{ content: 'text-md' }">
              <span class="text-md flex-1 w-3/5 truncate">{{ item.name }}</span>
            </UTooltip>
            <UTooltip v-if="item.isModified" text="有修改未提交">
              <UIcon name="i-lucide-circle-alert" class="w-3 h-3 text-warning shrink-0" />
            </UTooltip>
          </div>
        </div>

        <!-- Empty state (no sub-git_projects and no documents) -->
        <!-- <div v-else class="px-2 py-2 text-xs text-muted" :style="{ marginLeft: `${(level + 1) * 16}px` }">
          暂无文档
        </div> -->
      </div>
    </template>

    <template v-if="props.onlyGroup && props.isExpanded">
      <!-- Sub-git_projects (nested git_projects) -->
      <template v-if="props.project.subProjects && props.project.subProjects.length > 0">
        <ProjectTreeItem
          v-for="subProject in props.project.subProjects"
          :key="subProject.projectCode"
          :project="subProject"
          :is-selected="selectedNodeId === `project-${subProject.projectCode}`"
          :is-managed="isProjectManaged(subProject)"
          :managed-project-codes="props.managedProjectCodes"
          :selected-node-id="selectedNodeId"
          :is-expanded="subProject.isExpanded"
          :level="level + 1"
          :docs-loading="docsLoading"
          :only-group="props.onlyGroup"
          :show-recycle-bin="props.showRecycleBin"
          :trash-documents="props.trashDocuments"
          :trash-loading="props.trashLoading"
          @toggle="$emit('toggle', subProject)"
          @select="(id: string, type: 'project' | 'folder' | 'document', data: Project | ProjectFileItem | Record<string, unknown>) => $emit('select', id, type, data)"
          @delete="(type: 'project' | 'folder' | 'document', id: string | number, name: string) => $emit('delete', type, id, name)"
          @restore="(doc: Record<string, unknown>) => $emit('restore', doc)"
          @renamed="$emit('renamed')"
        />
      </template>

      <div
        v-if="props.docsLoading || props.project.docsLoading || props.trashLoading"
        class="px-2 py-2 text-xs text-muted"
        :style="{ marginLeft: `${(level + 1) * 16}px` }"
      >
        正在加载...
      </div>

      <!-- 回收站模式：显示已删除文档 -->
      <template v-else-if="props.showRecycleBin">
        <!-- <div v-if="currentProjectTrashDocs.length === 0" class="px-2 py-2 text-xs text-muted"
          :style="{ marginLeft: `${(level + 1) * 16}px` }">
          回收站为空
        </div>
        <div v-else class="space-y-0.5"> -->
        <div
          v-for="doc in currentProjectTrashDocs"
          :key="doc.uuid as string"
          class="group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-elevated"
          :class="{ 'bg-primary/10 text-primary': selectedNodeId === doc.uuid }"
          :style="{ paddingLeft: `${(level + 1) * 16}px` }"
          @click.stop="$emit('select', doc.uuid as string, 'document', doc, props.project)"
        >
          <UIcon name="i-lucide-file-x-2" class="w-4 h-4 shrink-0 text-gray-400" />
          <div class="flex-1 min-w-0">
            <p class="text-sm truncate">
              {{ doc.title || '未命名文档' }}
            </p>
            <p v-if="doc.deleted_at" class="text-xs text-muted truncate">
              {{ formatDeletedAt(doc.deleted_at as string) }}
            </p>
          </div>
          <UButton
            v-if="doc"
            icon="i-lucide-archive-restore"
            size="xs"
            color="primary"
            variant="ghost"
            class="opacity-0 group-hover:opacity-100"
            @click.stop="$emit('restore', doc)"
          />
        </div>
        <!-- </div> -->
      </template>

      <!-- 正常模式：显示文档树 -->
      <div v-else-if="props.project.docsTree && props.project.docsTree.length > 0" class="space-y-0.5">
        <GroupFileTreeItem
          v-for="child in props.project.docsTree"
          :key="child.id"
          :item="child"
          :level="0"
          :selected-id="selectedNodeId"
          :expanded-ids="expandedFolderIds"
          :editing-id="editingId"
          :editing-name="editingName"
          :project="props.project"
          :base-indent="(level + 1) * 16"
          @toggle="handleFolderToggle"
          @delete="(type: 'project' | 'folder' | 'document', id: string | number, name: string) => emit('delete', type, id, name)"
          @select="(id: string, type: 'project' | 'folder' | 'document', data: Project | ProjectFileItem | Record<string, unknown>, p?: Project) => emit('select', id, type, data, p || props.project)"
          @start-edit="startEdit"
          @save-edit="saveEdit"
          @cancel-edit="cancelEdit"
          @update:editing-name="(val: string) => editingName = val"
        />
      </div>

      <!-- Empty state (no sub-git_projects and no documents) -->
      <!-- <div v-else class="px-2 py-2 text-xs text-muted" :style="{ marginLeft: `${(level + 1) * 16}px` }">
        暂无文档
      </div> -->
    </template>
  </div>
</template>
