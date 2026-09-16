<script setup lang="ts">
import type { Project } from '~/types/account'

const props = defineProps<{
  node: Project
  selectedProjectCode: string
  depth?: number
}>()

const emit = defineEmits<{
  select: [projectCode: string]
}>()

const depth = computed(() => props.depth || 0)
const hasChildren = computed(() => (props.node.subProjects?.length || 0) > 0)
const isExpanded = ref(false)
const isSelected = computed(() => props.selectedProjectCode === props.node.projectCode)
const isGroup = computed(() => Number(props.node.isGroup) === 1)

const hasSelectedDescendant = computed(() => {
  if (!props.node.subProjects?.length) return false
  const visit = (nodes: Project[]): boolean => {
    for (const child of nodes) {
      if (child.projectCode === props.selectedProjectCode) return true
      if (child.subProjects?.length && visit(child.subProjects)) return true
    }
    return false
  }
  return visit(props.node.subProjects)
})

watch(hasSelectedDescendant, (value) => {
  if (value) isExpanded.value = true
}, { immediate: true })

watch(isSelected, (value) => {
  if (value && hasChildren.value) isExpanded.value = true
}, { immediate: true })

const toggle = (event: Event) => {
  event.stopPropagation()
  isExpanded.value = !isExpanded.value
}

const select = () => {
  emit('select', props.node.projectCode)
}
</script>

<template>
  <div>
    <div
      class="flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer text-sm transition-colors"
      :class="{
        'bg-primary/10 text-primary font-medium': isSelected,
        'hover:bg-elevated': !isSelected
      }"
      :style="{ paddingLeft: `${depth * 12 + 8}px` }"
      @click="select"
    >
      <button
        v-if="hasChildren"
        class="p-0.5 rounded hover:bg-muted shrink-0"
        @click="toggle"
      >
        <UIcon :name="isExpanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="w-3 h-3" />
      </button>
      <div v-else class="w-4" />
      <UIcon
        :name="isGroup ? 'i-lucide-folder-tree' : 'i-lucide-folder-kanban'"
        :class="[isGroup ? 'text-primary' : 'text-amber-500', 'w-3.5 h-3.5 shrink-0']"
      />
      <span class="truncate">{{ node.name }}</span>
      <span v-if="isGroup" class="ml-auto text-[10px] text-muted uppercase tracking-wide shrink-0">组</span>
    </div>
    <div v-if="hasChildren && isExpanded">
      <ProjectTreeSelector
        v-for="child in node.subProjects"
        :key="child.projectCode"
        :node="child"
        :selected-project-code="selectedProjectCode"
        :depth="depth + 1"
        @select="emit('select', $event)"
      />
    </div>
  </div>
</template>
