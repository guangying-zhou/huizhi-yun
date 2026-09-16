<script setup lang="ts">
defineOptions({
  name: 'RecursiveTreeItem'
})

interface TreeItem {
  type: 'folder' | 'document'
  id: string
  name: string
  ossPath: string
  data: Record<string, unknown>
  children?: TreeItem[]
  isModified?: boolean
  hasConflict?: boolean
}

interface Props {
  item: TreeItem
  level?: number
  selectedNodeId: string
  expandedFolders: Set<string>
  isManaged: boolean
}

withDefaults(defineProps<Props>(), {
  level: 1
})

const emit = defineEmits<{
  select: [nodeId: string, nodeType: 'folder' | 'document', data: Record<string, unknown>]
  toggleFolder: [folderId: string]
  newDoc: []
}>()
</script>

<template>
  <div>
    <!-- Folder -->
    <div v-if="item.type === 'folder'">
      <div
        class="group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-elevated"
        :class="{ 'bg-primary/10 text-primary': selectedNodeId === item.id }"
        :style="{ paddingLeft: `${level * 0.5 + 0.5}rem` }"
        @click.stop="$emit('select', item.id, 'folder', item.data)"
      >
        <UIcon
          :name="expandedFolders.has(item.id) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          class="w-3.5 h-3.5 shrink-0 cursor-pointer"
        />
        <UIcon name="i-lucide-folder" class="w-4 h-4 shrink-0" />
        <span class="text-sm flex-1 truncate">{{ item.name }}</span>

        <div
          v-if="isManaged"
          class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <button
            class="p-0.5 rounded hover:bg-muted"
            title="新建文档"
            @click.stop="$emit('select', item.id, 'folder', item.data); $emit('newDoc')"
          >
            <UIcon name="i-lucide-file-plus" class="w-3.5 h-3.5 text-muted" />
          </button>
        </div>
      </div>

      <!-- Recursive Children -->
      <div v-if="expandedFolders.has(item.id) && item.children && item.children.length > 0" class="space-y-0.5">
        <RecursiveTreeItem
          v-for="child in item.children"
          :key="child.id"
          :item="child"
          :level="level + 1"
          :selected-node-id="selectedNodeId"
          :expanded-folders="expandedFolders"
          :is-managed="isManaged"
          @select="(id: string, type: 'folder' | 'document', data: Record<string, unknown>) => emit('select', id, type, data)"
          @toggle-folder="(id: string) => emit('toggleFolder', id)"
          @new-doc="emit('newDoc')"
        />
      </div>
      <!-- Empty Folder State -->
      <div
        v-else-if="expandedFolders.has(item.id)"
        class="px-2 py-1 text-xs text-muted"
        :style="{ paddingLeft: `${(level + 1) * 0.5 + 1.5}rem` }"
      >
        暂无内容
      </div>
    </div>

    <!-- Document -->
    <div
      v-else
      class="group flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer hover:bg-elevated"
      :class="{ 'bg-primary/10 text-primary': selectedNodeId === item.id }"
      :style="{ paddingLeft: `${level * 0.5 + 0.5 + 1}rem` }"
      @click.stop="$emit('select', item.id, 'document', item.data)"
    >
      <!-- Padding to align with folder text (chevron width + gap) -->
      <!-- Alternatively, use indentation directly -->
      <UIcon name="i-lucide-file-text" class="w-4 h-4 shrink-0" />
      <span class="text-sm flex-1 truncate">{{ item.name }}</span>

      <UTooltip v-if="item.isModified && !item.ossPath.startsWith('codocs/projects/')" text="有修改未提交">
        <UIcon name="i-lucide-circle-alert" class="w-3 h-3 text-warning shrink-0" />
      </UTooltip>
      <UTooltip v-if="item.hasConflict && !item.ossPath.startsWith('codocs/projects/')" text="有冲突">
        <UIcon name="i-lucide-triangle-alert" class="w-3 h-3 text-error shrink-0" />
      </UTooltip>
    </div>
  </div>
</template>
