<script setup lang="ts">
import type { TreeItem } from '@nuxt/ui'

interface ContentNode {
  id: number
  title: string
  headingDepth: number
  status: string
  requirementId: number | null
  contentMd: string | null
  createdAt: string
  children: ContentNode[]
}

interface ReqBrief {
  id: number
  reqCode: string
  title: string
  status: string
  createdAt: string
}

interface ReqTreeItem extends TreeItem {
  id: number
  nodeRef: ContentNode
  ancestorLocked: boolean
  ancestorReqId: number | null
  ancestorModuleId: number | null
  children?: ReqTreeItem[]
}

const props = defineProps<{
  nodes: ContentNode[]
  linkedRequirements: ReqBrief[]
  checkedIds: Set<number>
  selectedId: number | null
  highlightReqId: number | null
}>()

const emit = defineEmits<{
  'update:checkedIds': [ids: Set<number>]
  'click': [id: number]
}>()

const reqMap = computed(() => {
  const map = new Map<number, ReqBrief>()
  for (const r of props.linkedRequirements) {
    map.set(r.id, r)
  }
  return map
})

function shouldInheritAncestorRequirement(node: ContentNode, ancestorReqId: number | null): boolean {
  if (!ancestorReqId || node.requirementId != null) return !!ancestorReqId
  const ancestorReq = reqMap.value.get(ancestorReqId)
  if (!ancestorReq?.createdAt || !node.createdAt) return true
  const nodeTs = Date.parse(node.createdAt)
  const reqTs = Date.parse(ancestorReq.createdAt)
  if (Number.isNaN(nodeTs) || Number.isNaN(reqTs)) return true
  return nodeTs <= reqTs
}

// Build items for UTree
function buildItem(
  node: ContentNode,
  ancestorLocked: boolean,
  ancestorReqId: number | null,
  ancestorModuleId: number | null
): ReqTreeItem {
  const inheritedAncestorReqId = shouldInheritAncestorRequirement(node, ancestorReqId)
    ? ancestorReqId
    : null
  const inheritedAncestorModuleId = inheritedAncestorReqId ? ancestorModuleId : null
  const isReq = node.requirementId != null
  const childAncestorLocked = (inheritedAncestorReqId ? ancestorLocked : false) || isReq
  const childAncestorReqId = inheritedAncestorReqId ?? (isReq ? node.requirementId : null)
  const childAncestorModuleId = inheritedAncestorModuleId ?? (isReq && node.children.length > 0 ? node.id : null)

  const item: ReqTreeItem = {
    id: node.id,
    label: node.title,
    value: String(node.id),
    nodeRef: node,
    ancestorLocked: inheritedAncestorReqId ? ancestorLocked : false,
    ancestorReqId: inheritedAncestorReqId,
    ancestorModuleId: inheritedAncestorModuleId,
    children: node.children.length > 0
      ? node.children.map(c => buildItem(c, childAncestorLocked, childAncestorReqId, childAncestorModuleId))
      : undefined
  }
  return item
}

const treeItems = computed<ReqTreeItem[]>(() => {
  return props.nodes.map(n => buildItem(n, false, null, null))
})

// Build a flat map of id → item for lookup
const itemsById = computed(() => {
  const map = new Map<number, ReqTreeItem>()
  function walk(items: ReqTreeItem[]) {
    for (const it of items) {
      map.set(it.id, it)
      if (it.children) walk(it.children)
    }
  }
  walk(treeItems.value)
  return map
})

// Model for UTree: array of items
const modelValue = computed<ReqTreeItem[]>({
  get() {
    const result: ReqTreeItem[] = []
    for (const id of props.checkedIds) {
      const it = itemsById.value.get(id)
      if (it) result.push(it)
    }
    return result
  },
  set(items: ReqTreeItem[]) {
    const newSet = new Set<number>(items.map(it => it.id))
    emit('update:checkedIds', newSet)
  }
})

function handleSelect(_e: unknown, item: ReqTreeItem) {
  if (item.ancestorModuleId != null) {
    emit('click', item.ancestorModuleId)
  } else {
    emit('click', item.id)
  }
}

// Always block UTree's default expand/collapse on row click
function onToggle(e: Event) {
  e.preventDefault()
}

// Controlled expand state (string values)
const expandedValues = ref<string[]>([])

function collectExpandable(items: ReqTreeItem[], out: string[]) {
  for (const it of items) {
    if (it.children?.length) {
      out.push(it.value as string)
      collectExpandable(it.children, out)
    }
  }
}

let initialized = false
watchEffect(() => {
  if (!initialized && treeItems.value.length > 0) {
    const all: string[] = []
    collectExpandable(treeItems.value, all)
    expandedValues.value = all
    initialized = true
  }
})

function isExpanded(item: ReqTreeItem): boolean {
  return expandedValues.value.includes(item.value as string)
}

function toggleExpanded(item: ReqTreeItem, e: Event) {
  e.stopPropagation()
  e.preventDefault()
  const val = item.value as string
  if (expandedValues.value.includes(val)) {
    expandedValues.value = expandedValues.value.filter(v => v !== val)
  } else {
    expandedValues.value = [...expandedValues.value, val]
  }
}

function getLinkedReq(node: ContentNode): ReqBrief | undefined {
  if (node.requirementId) return reqMap.value.get(node.requirementId)
  return undefined
}

function isDeletedNode(item: ReqTreeItem): boolean {
  return item.nodeRef.status === 'deprecated'
}

function isHighlighted(item: ReqTreeItem): boolean {
  const node = item.nodeRef
  if (props.selectedId === node.id) return true
  if (props.highlightReqId != null) {
    if (node.requirementId === props.highlightReqId) return true
    if (item.ancestorReqId === props.highlightReqId) return true
  }
  return false
}
</script>

<template>
  <UTree
    v-model="modelValue"
    v-model:expanded="expandedValues"
    :items="treeItems"
    multiple
    propagate-select
    bubble-select
    :get-key="(item: ReqTreeItem) => item.value"
    @select="handleSelect"
    @toggle="onToggle"
  >
    <template #item-leading="{ item, selected, indeterminate, handleSelect: onCheckboxChange }">
      <UIcon
        v-if="(item as ReqTreeItem).nodeRef.headingDepth === 2"
        name="i-lucide-folder"
        class="size-3.5 shrink-0 text-muted"
      />
      <UBadge
        v-else-if="getLinkedReq((item as ReqTreeItem).nodeRef)"
        color="secondary"
        variant="subtle"
        size="xs"
        class="shrink-0"
      >
        {{ getLinkedReq((item as ReqTreeItem).nodeRef)!.reqCode }}
      </UBadge>
      <UBadge
        v-else-if="(item as ReqTreeItem).ancestorReqId && reqMap.get((item as ReqTreeItem).ancestorReqId!)"
        color="secondary"
        variant="subtle"
        size="xs"
        class="shrink-0"
      >
        {{ reqMap.get((item as ReqTreeItem).ancestorReqId!)!.reqCode }}
      </UBadge>
      <UIcon
        v-else-if="(item as ReqTreeItem).nodeRef.children.length > 0 && (item as ReqTreeItem).nodeRef.children.every((c: ContentNode) => c.requirementId != null)"
        name="i-lucide-lock"
        class="size-3.5 shrink-0 text-muted"
      />
      <UCheckbox
        v-else-if="(item as ReqTreeItem).nodeRef.status !== 'deprecated'"
        :model-value="indeterminate ? 'indeterminate' : selected"
        tabindex="-1"
        @change="onCheckboxChange"
        @click.stop
      />
      <UIcon
        v-else
        name="i-lucide-trash-2"
        class="size-3.5 shrink-0 text-error"
      />
    </template>

    <template #item-label="{ item }">
      <span
        class="truncate"
        :class="[
          isHighlighted(item as ReqTreeItem) ? 'text-primary font-medium' : '',
          isDeletedNode(item as ReqTreeItem) ? 'line-through text-muted' : ''
        ]"
      >
        {{ (item as ReqTreeItem).label }}
      </span>
    </template>

    <template #item-trailing="{ item }">
      <UBadge
        v-if="isDeletedNode(item as ReqTreeItem)"
        color="error"
        variant="subtle"
        size="xs"
        class="mr-1"
      >
        已删除
      </UBadge>
      <button
        v-if="(item as ReqTreeItem).children && (item as ReqTreeItem).children!.length > 0"
        type="button"
        class="shrink-0 p-1 -m-1 rounded hover:bg-elevated text-muted"
        @click="(e: Event) => toggleExpanded(item as ReqTreeItem, e)"
        @mousedown.stop
        @pointerdown.stop
      >
        <UIcon
          :name="isExpanded(item as ReqTreeItem) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
          class="size-4"
        />
      </button>
    </template>
  </UTree>
</template>
