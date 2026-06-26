<script setup lang="ts">
interface FolderNode {
  id: number
  name: string
  parent_id: number | null
  children: FolderNode[]
}

interface Props {
  folder: FolderNode
  selectedId: number | null
  expandedIds: Set<number>
  depth?: number
}

const props = withDefaults(defineProps<Props>(), {
  depth: 0
})

const emit = defineEmits<{
  select: [id: number]
  toggle: [id: number]
  createFolder: [parentId: number]
  createDoc: [folderId: number]
  rename: [id: number, newName: string]
  delete: [id: number, name: string]
}>()

const hasChildren = computed(() => props.folder.children.length > 0)
const isExpanded = computed(() => props.expandedIds.has(props.folder.id))
const isSelected = computed(() => props.selectedId === props.folder.id)

// Inline editing state
const isEditing = ref(false)
const editName = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

const handleClick = () => {
  emit('select', props.folder.id)
}

const handleToggle = (e: Event) => {
  e.stopPropagation()
  emit('toggle', props.folder.id)
}

// Double-click to edit
const handleDoubleClick = (e: Event) => {
  e.stopPropagation()
  isEditing.value = true
  editName.value = props.folder.name
  nextTick(() => {
    inputRef.value?.focus()
    inputRef.value?.select()
  })
}

// Save edit
const saveEdit = () => {
  if (editName.value.trim() && editName.value !== props.folder.name) {
    emit('rename', props.folder.id, editName.value.trim())
  }
  isEditing.value = false
}

// Cancel edit
const cancelEdit = () => {
  isEditing.value = false
  editName.value = ''
}

// Action button handlers
const handleCreateFolder = (e: Event) => {
  e.stopPropagation()
  emit('createFolder', props.folder.id)
}

const handleCreateDoc = (e: Event) => {
  e.stopPropagation()
  emit('createDoc', props.folder.id)
}

const handleDelete = (e: Event) => {
  e.stopPropagation()
  emit('delete', props.folder.id, props.folder.name)
}
</script>

<template>
  <div>
    <div
      class="group flex items-center gap-1 px-2 py-1.5 rounded-md cursor-pointer hover:bg-elevated"
      :class="{
        'bg-primary/10 text-primary': isSelected
      }"
      :style="{ paddingLeft: `${(depth * 12) + 8}px` }"
      @click="handleClick"
    >
      <!-- Expand/Collapse toggle -->
      <button v-if="hasChildren" class="p-0.5 rounded hover:bg-muted" @click="handleToggle">
        <UIcon
          :name="isExpanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          class="w-3 h-3 text-muted"
        />
      </button>
      <span v-else class="w-4" />

      <!-- Folder icon -->
      <UIcon
        :name="isExpanded ? 'i-lucide-folder-open' : 'i-lucide-folder'"
        class="w-4 h-4 text-yellow-500 shrink-0"
      />

      <!-- Folder name (editable) -->
      <div v-if="isEditing" class="flex items-center gap-1 flex-1 min-w-0">
        <input
          ref="inputRef"
          v-model="editName"
          class="flex-1 text-sm px-1 py-0 border border-primary rounded bg-default outline-none min-w-0"
          @keyup.enter="saveEdit"
          @keyup.escape="cancelEdit"
          @click.stop
        >
        <button class="p-0.5 rounded hover:bg-green-100 text-green-600" title="保存" @click.stop="saveEdit">
          <UIcon name="i-lucide-check" class="w-4 h-4" />
        </button>
        <button class="p-0.5 rounded hover:bg-red-100 text-red-600" title="取消" @click.stop="cancelEdit">
          <UIcon name="i-lucide-x" class="w-4 h-4" />
        </button>
      </div>
      <span v-else class="text-sm truncate flex-1" @dblclick="handleDoubleClick">{{ folder.name }}</span>

      <!-- Action buttons: create icons on hover (always), delete icon when selected -->
      <div class="flex items-center gap-0.5">
        <!-- Create buttons: visible on hover regardless of selection -->
        <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button class="p-0.5 rounded hover:bg-muted" title="新建子文件夹" @click="handleCreateFolder">
            <UIcon name="i-lucide-folder-plus" class="w-3.5 h-3.5 text-muted" />
          </button>
          <button class="p-0.5 rounded hover:bg-muted" title="新建文档" @click="handleCreateDoc">
            <UIcon name="i-lucide-file-plus" class="w-3.5 h-3.5 text-muted" />
          </button>
        </div>
        <!-- Delete button: always visible when selected -->
        <button
          v-if="isSelected"
          class="p-0.5 rounded hover:bg-muted hover:text-red-500"
          title="删除文件夹"
          @click="handleDelete"
        >
          <UIcon name="i-lucide-trash-2" class="w-3.5 h-3.5 text-muted" />
        </button>
      </div>
    </div>

    <!-- Children (recursive) -->
    <div v-if="hasChildren && isExpanded">
      <FolderTreeItem
        v-for="child in folder.children"
        :key="child.id"
        :folder="child"
        :selected-id="selectedId"
        :expanded-ids="expandedIds"
        :depth="depth + 1"
        @select="(id) => emit('select', id)"
        @toggle="(id) => emit('toggle', id)"
        @create-folder="(id) => emit('createFolder', id)"
        @create-doc="(id) => emit('createDoc', id)"
        @rename="(id, name) => emit('rename', id, name)"
        @delete="(id, name) => emit('delete', id, name)"
      />
    </div>
  </div>
</template>
