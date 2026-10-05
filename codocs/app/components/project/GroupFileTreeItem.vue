<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { ProjectDocsTreeItem } from '~/types'
import type { Project } from '~/types/account'

/**
 * 文件树项组件 - 递归显示文件夹和文档
 */

interface Props {
  item: ProjectDocsTreeItem
  level?: number
  baseIndent?: number
  selectedId: string
  expandedIds: Set<number>
  editingId: string | null
  editingName: string
  project?: Project
}

const props = withDefaults(defineProps<Props>(), {
  level: 0,
  baseIndent: 0
})

const emit = defineEmits<{
  'select': [nodeId: string, nodeType: 'project' | 'folder' | 'document', data: ProjectDocsTreeItem['data'], project?: Project]
  'toggle': [folderId: number]
  'startEdit': [id: string, name: string]
  'saveEdit': []
  'cancelEdit': []
  'delete': [type: 'folder' | 'document', id: number | string, name: string]
  'update:editingName': [value: string]
}>()

const localEditingName = ref(props.editingName)

watch(() => props.editingName, (newVal) => {
  localEditingName.value = newVal
})

const updateEditingName = (value: string) => {
  localEditingName.value = value
  emit('update:editingName', value)
}
const isFolder = computed(() => props.item.type === 'folder')
const isExpanded = computed(() => {
  if (!isFolder.value) return false
  return props.expandedIds.has(props.item.data.id as number)
})
const isSelected = computed(() => props.selectedId === props.item.nodeId)
const isEditing = computed(() => props.editingId === props.item.nodeId)
const hasChildren = computed(() => props.item.children && props.item.children.length > 0)

// 用延迟区分单击与双击，避免双击时触发选中/加载
let clickTimer: ReturnType<typeof setTimeout> | null = null

const handleClick = () => {
  // 如果有双击计时器，说明这是双击的第二次 click，跳过
  if (clickTimer) {
    clearTimeout(clickTimer)
    clickTimer = null
    return
  }
  clickTimer = setTimeout(() => {
    clickTimer = null
    // 如果已经选中，不重复触发
    if (isSelected.value && !isFolder.value) return
    // 选中节点
    emit('select', props.item.nodeId, props.item.type, props.item.data, props.project)
    // 如果是文件夹，也触发展开/折叠
    if (isFolder.value) {
      emit('toggle', props.item.data.id as number)
    }
  }, 250)
}

const handleDoubleClick = () => {
  if (clickTimer) {
    clearTimeout(clickTimer)
    clickTimer = null
  }
  emit('startEdit', props.item.nodeId, props.item.name)
}

const handleDelete = () => {
  const id = isFolder.value ? (props.item.data.id as number) : (props.item.data.uuid as string)
  emit('delete', props.item.type, id, props.item.name)
}

// 计算实际缩进
const actualPaddingLeft = computed(() => {
  // 文档类型不再有占位div，直接显示图标，所以不需要adjustment
  const padding = props.baseIndent + props.level * 16
  return `${Math.max(0, padding)}px`
})
</script>

<template>
  <div>
    <!-- Tree item -->
    <div
      class="group flex items-center gap-1 pl-3 pr-2 py-1.5 rounded-md cursor-pointer hover:bg-elevated"
      :class="{ 'bg-primary/10 text-primary font-medium': isSelected }"
      :style="{ paddingLeft: actualPaddingLeft }"
      @click="handleClick"
    >
      <!-- Expand/Collapse icon for folders -->
      <div v-if="isFolder" class="w-4 flex items-center justify-center shrink-0">
        <UIcon
          v-if="hasChildren"
          :name="isExpanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          class="w-3.5 h-3.5 text-muted transition-transform"
          @click.stop="emit('toggle', item.data.id as number)"
        />
      </div>

      <!-- Icon -->
      <UIcon
        :name="isFolder ? 'i-lucide-folder' : 'i-lucide-file-text'"
        :class="isFolder ? 'w-4 h-4 text-amber-500' : 'w-4 h-4 text-gray-500'"
        class="shrink-0"
      />

      <!-- Name (editable or display) -->
      <div v-if="isEditing" class="flex items-center gap-1 flex-1 min-w-0" @click.stop>
        <input
          v-model="localEditingName"
          class="flex-1 text-sm px-1 py-0 border border-primary rounded bg-default outline-none min-w-0"
          autofocus
          @input="updateEditingName(($event.target as HTMLInputElement).value)"
          @keyup.enter="emit('saveEdit')"
          @keyup.escape="emit('cancelEdit')"
          @click.stop
        >
        <button
          class="p-0.5 rounded hover:bg-green-100 text-green-600 shrink-0"
          title="保存"
          @click.stop="emit('saveEdit')"
        >
          <UIcon name="i-lucide-check" class="w-4 h-4" />
        </button>
        <button
          class="p-0.5 rounded hover:bg-red-100 text-red-600 shrink-0"
          title="取消"
          @click.stop="emit('cancelEdit')"
        >
          <UIcon name="i-lucide-x" class="w-4 h-4" />
        </button>
      </div>
      <UTooltip v-else :text="item.name" :ui="{ content: 'text-md' }">
        <span class="text-md flex-1 truncate" @dblclick.stop="handleDoubleClick">
          {{ item.name }}
        </span>
      </UTooltip>

      <!-- Actions (show on hover) -->
      <div
        v-if="!isEditing"
        class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
      >
        <button class="p-0.5 rounded hover:text-red-400 text-gray-500" title="删除" @click.stop="handleDelete">
          <UIcon name="i-lucide-trash-2" class="w-3.5 h-3.5" />
        </button>
      </div>
    </div>

    <!-- Children (recursive) -->
    <div v-if="isFolder && isExpanded && hasChildren">
      <GroupFileTreeItem
        v-for="child in item.children"
        :key="child.id"
        :item="child"
        :level="level + 1"
        :base-indent="baseIndent"
        :selected-id="selectedId"
        :expanded-ids="expandedIds"
        :editing-id="editingId"
        :editing-name="editingName"
        :project="project"
        @select="(id, type, data, p) => emit('select', id, type, data, p || project)"
        @toggle="(folderId) => emit('toggle', folderId)"
        @start-edit="(id, name) => emit('startEdit', id, name)"
        @save-edit="emit('saveEdit')"
        @cancel-edit="emit('cancelEdit')"
        @delete="(type, id, name) => emit('delete', type, id, name)"
        @update:editing-name="(val) => emit('update:editingName', val)"
      />
    </div>
  </div>
</template>
