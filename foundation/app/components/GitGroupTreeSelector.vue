<script setup lang="ts">
/**
 * GitLab 群组树形选择器（单选）
 * 用法：
 *   <GitGroupTreeSelector v-model="form.gitGroup" :tree="tree" placeholder="选择 GitLab 群组" />
 */
import type { Project } from '../types/account'

const props = defineProps<{
  modelValue: string | null | undefined
  tree: Project[]
  placeholder?: string
  disabled?: boolean
  loading?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const open = ref(false)
const keyword = ref('')

// 扁平查询当前选中节点以显示 label
const flat = computed(() => {
  const result: Project[] = []
  const walk = (list: Project[]) => {
    for (const item of list) {
      result.push(item)
      if (item.subProjects?.length) walk(item.subProjects)
    }
  }
  walk(props.tree)
  return result
})

const selectedLabel = computed(() => {
  if (!props.modelValue) return ''
  const hit = flat.value.find(p => p.projectCode === props.modelValue)
  return hit ? `${hit.name} (${hit.projectCode})` : props.modelValue
})

// 过滤（关键字匹配 name 或 projectCode；匹配到节点时保留祖先路径）
function filterTree(nodes: Project[], kw: string): Project[] {
  if (!kw) return nodes
  const lower = kw.toLowerCase()
  const matches = (p: Project) =>
    p.name.toLowerCase().includes(lower)
    || p.projectCode.toLowerCase().includes(lower)

  const walk = (list: Project[]): Project[] => {
    const out: Project[] = []
    for (const node of list) {
      const children = node.subProjects?.length ? walk(node.subProjects) : []
      if (matches(node) || children.length > 0) {
        out.push({ ...node, subProjects: children })
      }
    }
    return out
  }
  return walk(nodes)
}

const displayedTree = computed(() => filterTree(props.tree, keyword.value.trim()))

// 展开状态：搜索时默认展开全部，否则仅展开选中路径
const expanded = ref<Set<string>>(new Set())

function hasSelectedDescendant(node: Project): boolean {
  if (!props.modelValue) return false
  if (node.projectCode === props.modelValue) return true
  if (!node.subProjects?.length) return false
  return node.subProjects.some(hasSelectedDescendant)
}

function isExpanded(code: string): boolean {
  if (keyword.value.trim()) return true
  return expanded.value.has(code)
}

function toggleExpand(code: string) {
  if (keyword.value.trim()) return
  if (expanded.value.has(code)) expanded.value.delete(code)
  else expanded.value.add(code)
  expanded.value = new Set(expanded.value)
}

// 打开时若有选中值，自动展开其祖先路径
watch(open, (val) => {
  if (!val) {
    keyword.value = ''
    return
  }
  if (!props.modelValue) return
  const path = new Set<string>()
  const walk = (list: Project[], parents: string[]): boolean => {
    for (const node of list) {
      if (node.projectCode === props.modelValue) {
        parents.forEach(c => path.add(c))
        return true
      }
      if (node.subProjects?.length && walk(node.subProjects, [...parents, node.projectCode])) {
        return true
      }
    }
    return false
  }
  walk(props.tree, [])
  expanded.value = new Set([...expanded.value, ...path])
})

function select(node: Project) {
  emit('update:modelValue', node.projectCode)
  open.value = false
}
</script>

<template>
  <UPopover v-model:open="open" :disabled="disabled">
    <UButton
      variant="outline"
      color="neutral"
      :disabled="disabled"
      :loading="loading"
      class="w-full justify-between font-normal"
      trailing-icon="i-lucide-chevron-down"
    >
      <span :class="selectedLabel ? '' : 'text-dimmed'">
        {{ selectedLabel || placeholder || '选择 GitLab 群组' }}
      </span>
    </UButton>
    <template #content>
      <div class="w-[28rem] max-w-[calc(100vw-2rem)] flex flex-col">
        <div class="p-2 border-b border-default">
          <UInput
            v-model="keyword"
            placeholder="搜索群组名称或代码..."
            icon="i-lucide-search"
            size="sm"
            class="w-full"
            :ui="{ base: 'w-full' }"
          />
        </div>
        <div class="max-h-80 overflow-y-auto p-1">
          <div v-if="tree.length === 0 && !loading" class="text-center py-6 text-sm text-muted">
            暂无可选群组
          </div>
          <div v-else-if="displayedTree.length === 0" class="text-center py-6 text-sm text-muted">
            无匹配结果
          </div>
          <template v-else>
            <GitGroupTreeNode
              v-for="node in displayedTree"
              :key="node.projectCode"
              :node="node"
              :selected-code="modelValue || ''"
              :is-expanded="isExpanded"
              :has-selected-descendant="hasSelectedDescendant"
              @select="select"
              @toggle="toggleExpand"
            />
          </template>
        </div>
      </div>
    </template>
  </UPopover>
</template>
