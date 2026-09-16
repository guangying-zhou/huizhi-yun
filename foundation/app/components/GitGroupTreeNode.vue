<script setup lang="ts">
import type { Project } from '../types/account'

const props = defineProps<{
  node: Project
  selectedCode: string
  depth?: number
  isExpanded: (code: string) => boolean
  hasSelectedDescendant: (node: Project) => boolean
}>()

const emit = defineEmits<{
  select: [node: Project]
  toggle: [code: string]
}>()

const depth = computed(() => props.depth || 0)
const hasChildren = computed(() => (props.node.subProjects?.length || 0) > 0)
const isSelected = computed(() => props.selectedCode === props.node.projectCode)
const expanded = computed(() =>
  props.isExpanded(props.node.projectCode) || props.hasSelectedDescendant(props.node)
)

function onRowClick() {
  emit('select', props.node)
}

function onToggle(e: Event) {
  e.stopPropagation()
  emit('toggle', props.node.projectCode)
}
</script>

<template>
  <div>
    <div
      class="flex items-center gap-1.5 px-2 py-1.5 rounded-md cursor-pointer text-sm transition-colors"
      :class="{
        'bg-primary/10 text-primary font-medium': isSelected,
        'hover:bg-elevated': !isSelected
      }"
      :style="{ paddingLeft: `${depth * 14 + 8}px` }"
      @click="onRowClick"
    >
      <button
        v-if="hasChildren"
        class="p-0.5 rounded hover:bg-muted shrink-0"
        @click="onToggle"
      >
        <UIcon
          :name="expanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          class="size-3.5 text-muted"
        />
      </button>
      <div v-else class="w-4 shrink-0" />
      <UIcon
        :name="hasChildren ? 'i-lucide-folder' : 'i-lucide-git-branch'"
        class="size-3.5 shrink-0"
        :class="hasChildren ? 'text-warning' : 'text-success'"
      />
      <span class="truncate flex-1">{{ node.name }}</span>
      <span class="text-xs text-dimmed truncate max-w-[12rem]">{{ node.projectCode }}</span>
    </div>
    <div v-if="hasChildren && expanded">
      <GitGroupTreeNode
        v-for="child in node.subProjects"
        :key="child.projectCode"
        :node="child"
        :selected-code="selectedCode"
        :depth="depth + 1"
        :is-expanded="isExpanded"
        :has-selected-descendant="hasSelectedDescendant"
        @select="emit('select', $event)"
        @toggle="emit('toggle', $event)"
      />
    </div>
  </div>
</template>
