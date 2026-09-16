<script setup lang="ts">
defineOptions({
  name: 'MoveFolderItem'
})
/**
 * 移动文档时的文件夹选择项
 * 简化版文件夹树组件，仅用于选择目标文件夹
 */
interface FolderNode {
  id: number
  name: string
  parent_id: number | null
  children: FolderNode[]
}

interface Props {
  folder: FolderNode
  selectedId: number | null
  currentFolderId: number | null | undefined
  depth?: number
}

const props = withDefaults(defineProps<Props>(), {
  depth: 0
})

const emit = defineEmits<{
  select: [id: number]
}>()

const isExpanded = ref(true) // 默认展开所有文件夹
const hasChildren = computed(() => props.folder.children.length > 0)
const isSelected = computed(() => props.selectedId === props.folder.id)
const isCurrent = computed(() => props.currentFolderId === props.folder.id)

const handleClick = () => {
  emit('select', props.folder.id)
}

const handleToggle = (e: Event) => {
  e.stopPropagation()
  isExpanded.value = !isExpanded.value
}
</script>

<template>
  <div>
    <div
      class="flex items-center gap-1 px-2 py-1.5 rounded-md cursor-pointer hover:bg-elevated"
      :class="{
        'bg-primary/10 text-primary': isSelected,
        'opacity-50': isCurrent
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

      <!-- Folder name -->
      <span class="text-sm truncate flex-1">{{ folder.name }}</span>

      <!-- Current location indicator -->
      <span v-if="isCurrent" class="text-xs text-muted">(当前位置)</span>
    </div>

    <!-- Children (recursive) -->
    <div v-if="hasChildren && isExpanded">
      <MoveFolderItem
        v-for="child in folder.children"
        :key="child.id"
        :folder="child"
        :selected-id="selectedId"
        :current-folder-id="currentFolderId"
        :depth="depth + 1"
        @select="(id) => emit('select', id)"
      />
    </div>
  </div>
</template>
