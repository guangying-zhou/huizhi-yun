<script setup lang="ts">
import type { ProjectDocsTreeItem } from '~/types'

/**
 * 文件树项组件 - 递归显示文件夹和文档
 */

interface Props {
  item: ProjectDocsTreeItem
  level?: number
  selectedId: string
  expandedIds: Set<number>
  editingId: string | null
  editingName: string
  canMutate?: boolean
  canDelete?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  level: 0,
  canMutate: true,
  canDelete: true
})

const emit = defineEmits<{
  'select': [id: string, type: 'folder' | 'document', data: ProjectDocsTreeItem['data']]
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

// 用延迟区分单击与双击，避免双击时触发两次选中/加载
let clickTimer: ReturnType<typeof setTimeout> | null = null

const handleClick = () => {
  if (clickTimer) {
    clearTimeout(clickTimer)
    clickTimer = null
    return
  }
  clickTimer = setTimeout(() => {
    clickTimer = null
    // 选中节点
    emit('select', props.item.nodeId, props.item.type, props.item.data)
    // 如果是文件夹，也触发展开/折叠
    if (isFolder.value) {
      emit('toggle', props.item.data.id as number)
    }
  }, 250)
}

const handleDoubleClick = () => {
  if (!props.canMutate) return
  if (clickTimer) {
    clearTimeout(clickTimer)
    clickTimer = null
  }
  emit('startEdit', props.item.nodeId, props.item.name)
}

const handleDelete = () => {
  if (!props.canDelete) return
  const id = isFolder.value ? (props.item.data.id as number) : (props.item.data.uuid as string)
  emit('delete', props.item.type, id, props.item.name)
}
</script>

<template>
  <div>
    <!-- Tree item -->
    <div
      class="group flex items-center gap-1 px-2 py-1.5 rounded-md cursor-pointer hover:bg-elevated"
      :class="{ 'bg-primary/10 text-primary font-medium': isSelected }"
      :style="{ paddingLeft: `${level * 16 + 8}px` }"
      @click="handleClick"
    >
      <!-- Expand/Collapse icon for folders -->
      <div class="w-4 flex items-center justify-center shrink-0">
        <UIcon
          v-if="isFolder && hasChildren"
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
      <span v-else class="text-sm flex-1 truncate" @dblclick.stop="handleDoubleClick">
        {{ item.name }}
      </span>

      <!-- Actions (show on hover) -->
      <div
        v-if="!isEditing && canDelete"
        class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
      >
        <button class="p-0.5 rounded hover:bg-red-100 text-red-600" title="删除" @click.stop="handleDelete">
          <UIcon name="i-lucide-trash-2" class="w-3.5 h-3.5" />
        </button>
      </div>
    </div>

    <!-- Children (recursive) -->
    <div v-if="isFolder && isExpanded && hasChildren">
      <FileTreeItem
        v-for="child in item.children"
        :key="child.id"
        :item="child"
        :level="level + 1"
        :selected-id="selectedId"
        :expanded-ids="expandedIds"
        :editing-id="editingId"
        :editing-name="editingName"
        :can-mutate="canMutate"
        :can-delete="canDelete"
        @select="(id: string, type: 'folder' | 'document', data: ProjectDocsTreeItem['data']) => emit('select', id, type, data)"
        @toggle="(folderId: number) => emit('toggle', folderId)"
        @start-edit="(id: string, name: string) => emit('startEdit', id, name)"
        @save-edit="emit('saveEdit')"
        @cancel-edit="emit('cancelEdit')"
        @delete="(type: 'folder' | 'document', id: number | string, name: string) => emit('delete', type, id, name)"
        @update:editing-name="(val: string) => emit('update:editingName', val)"
      />
    </div>
  </div>
</template>
