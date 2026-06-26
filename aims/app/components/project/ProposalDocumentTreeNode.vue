<script setup lang="ts">
interface TreeNode {
  type: 'folder' | 'document'
  key: string
  name: string
  folderId?: number | null
  docUuid?: string
  children?: TreeNode[]
}

const props = defineProps<{
  node: TreeNode
  depth: number
  expandedIds: Set<number>
  selectedUuid?: string | null
}>()

const emit = defineEmits<{
  'toggle-folder': [id: number]
  'select-doc': [uuid: string]
}>()

const isExpanded = computed(() => {
  if (props.node.type !== 'folder' || props.node.folderId == null) return false
  return props.expandedIds.has(props.node.folderId)
})

const isSelected = computed(() => {
  return props.node.type === 'document' && props.node.docUuid === props.selectedUuid
})

const paddingLeft = computed(() => `${props.depth * 1 + 0.5}rem`)
</script>

<template>
  <li>
    <button
      v-if="node.type === 'folder'"
      type="button"
      class="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-elevated/60 transition-colors text-left"
      :style="{ paddingLeft }"
      @click="emit('toggle-folder', node.folderId as number)"
    >
      <UIcon
        :name="isExpanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
        class="size-3.5 text-muted shrink-0"
      />
      <UIcon
        :name="isExpanded ? 'i-lucide-folder-open' : 'i-lucide-folder'"
        class="size-4 text-warning shrink-0"
      />
      <span class="truncate">{{ node.name }}</span>
      <span v-if="node.children?.length" class="text-xs text-dimmed ml-auto shrink-0">
        {{ node.children.length }}
      </span>
    </button>
    <button
      v-else
      type="button"
      class="w-full flex items-center gap-1.5 px-2 py-1.5 transition-colors text-left"
      :class="isSelected ? 'bg-primary-50 text-primary dark:bg-primary-950/40 ring-1 ring-primary' : 'hover:bg-elevated/60'"
      :style="{ paddingLeft: `calc(${paddingLeft} + 1rem)` }"
      @click="emit('select-doc', node.docUuid as string)"
    >
      <UIcon name="i-lucide-file-text" class="size-4 shrink-0" :class="isSelected ? 'text-primary' : 'text-info'" />
      <span class="truncate">{{ node.name }}</span>
      <UIcon
        v-if="isSelected"
        name="i-lucide-check"
        class="size-4 text-primary ml-auto shrink-0"
      />
    </button>

    <ul v-if="node.type === 'folder' && isExpanded && node.children?.length">
      <ProjectProposalDocumentTreeNode
        v-for="child in node.children"
        :key="child.key"
        :node="child"
        :depth="depth + 1"
        :expanded-ids="expandedIds"
        :selected-uuid="selectedUuid"
        @toggle-folder="(id) => emit('toggle-folder', id)"
        @select-doc="(uuid) => emit('select-doc', uuid)"
      />
    </ul>
  </li>
</template>
