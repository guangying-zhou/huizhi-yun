<script setup lang="ts">
interface DeptTreeNode {
  deptCode: string
  name: string
  orgType?: string
  children?: DeptTreeNode[]
}

const props = defineProps<{
  node: DeptTreeNode
  selectedDeptCode: string
  depth?: number
}>()

const emit = defineEmits<{
  select: [deptCode: string]
}>()

const depth = computed(() => props.depth || 0)
const hasChildren = computed(() => (props.node.children?.length || 0) > 0)
const isExpanded = ref(false)
const isSelected = computed(() => props.selectedDeptCode === props.node.deptCode)
const isCommittee = computed(() => props.node.orgType === 'committee')

// 检查是否有子节点被选中
const hasSelectedChild = computed(() => {
  if (!props.node.children) return false
  const checkChildren = (nodes: DeptTreeNode[]): boolean => {
    for (const child of nodes) {
      if (child.deptCode === props.selectedDeptCode) return true
      if (child.children?.length && checkChildren(child.children)) return true
    }
    return false
  }
  return checkChildren(props.node.children)
})

// 如果有子节点被选中，自动展开
watch(hasSelectedChild, (hasSelected) => {
  if (hasSelected) isExpanded.value = true
}, { immediate: true })

watch(isSelected, (selected) => {
  if (selected && hasChildren.value) isExpanded.value = true
}, { immediate: true })

const toggle = (e: Event) => {
  e.stopPropagation()
  isExpanded.value = !isExpanded.value
}

const select = () => {
  emit('select', props.node.deptCode)
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
      <button v-if="hasChildren" class="p-0.5 rounded hover:bg-muted shrink-0" @click="toggle">
        <UIcon :name="isExpanded ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="w-3 h-3" />
      </button>
      <div v-else class="w-4" />
      <UIcon
        :name="isCommittee ? 'i-lucide-users' : (hasChildren ? 'i-lucide-building-2' : 'i-lucide-building')"
        :class="[isCommittee ? 'text-indigo-500' : 'text-amber-500', 'w-3.5 h-3.5 shrink-0']"
      />
      <span class="truncate">{{ node.name }}</span>
    </div>
    <div v-if="hasChildren && isExpanded">
      <DeptTreeSelector
        v-for="child in node.children"
        :key="child.deptCode"
        :node="child"
        :selected-dept-code="selectedDeptCode"
        :depth="depth + 1"
        @select="emit('select', $event)"
      />
    </div>
  </div>
</template>
