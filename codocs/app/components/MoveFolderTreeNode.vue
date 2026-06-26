<script setup lang="ts">
/**
 * 移动文件夹树节点 - 递归组件
 */

interface TreeFolder {
  id: number
  name: string
  parent_id: number | null
  children: TreeFolder[]
}

interface Props {
  folder: TreeFolder
  level: number
  selectedId: number | null
  expandedIds: Set<number>
  disabledId: number | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  select: [folderId: number]
  toggle: [folderId: number]
}>()

const isSelected = computed(() => props.selectedId === props.folder.id)
const isExpanded = computed(() => props.expandedIds.has(props.folder.id))
const isDisabled = computed(() => props.disabledId === props.folder.id)
const hasChildren = computed(() => props.folder.children && props.folder.children.length > 0)
</script>

<template>
  <div>
    <div
      class="flex items-center gap-1.5 px-3 py-2 rounded-md cursor-pointer transition-colors mx-2"
      :class="{
        'bg-primary/10 text-primary font-medium': isSelected && !isDisabled,
        'opacity-50 cursor-not-allowed': isDisabled,
        'hover:bg-elevated': !isDisabled && !isSelected
      }"
      :style="{ paddingLeft: `${level * 16 + 12}px` }"
      @click="!isDisabled && emit('select', folder.id)"
    >
      <!-- Expand/Collapse -->
      <div class="w-4 flex items-center justify-center shrink-0">
        <UIcon
          v-if="hasChildren"
          :name="isExpanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          class="w-3.5 h-3.5 text-muted transition-transform"
          @click.stop="emit('toggle', folder.id)"
        />
      </div>

      <!-- Folder icon -->
      <UIcon name="i-lucide-folder" class="w-4 h-4 text-amber-500 shrink-0" />

      <!-- Name -->
      <span class="text-sm flex-1 truncate">{{ folder.name }}</span>

      <!-- Current marker -->
      <span v-if="isDisabled" class="text-xs text-muted shrink-0">（当前位置）</span>
    </div>

    <!-- Children (recursive) -->
    <div v-if="isExpanded && hasChildren">
      <MoveFolderTreeNode
        v-for="child in folder.children"
        :key="child.id"
        :folder="child"
        :level="level + 1"
        :selected-id="selectedId"
        :expanded-ids="expandedIds"
        :disabled-id="disabledId"
        @select="(id) => emit('select', id)"
        @toggle="(id) => emit('toggle', id)"
      />
    </div>
  </div>
</template>
