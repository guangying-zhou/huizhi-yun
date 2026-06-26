<script setup lang="ts">
interface FolderItem {
  id: number
  name: string
  parentId: number | null
}

interface DocumentItem {
  uuid: string
  title: string
  folderId: number | null
  updatedAt?: string
}

interface TreeNode {
  type: 'folder' | 'document'
  key: string
  name: string
  folderId?: number | null
  docUuid?: string
  children?: TreeNode[]
  updatedAt?: string
}

const props = defineProps<{
  folders: FolderItem[]
  documents: DocumentItem[]
  selectedUuid?: string | null
  loading?: boolean
  search?: string
}>()

const emit = defineEmits<{
  select: [uuid: string]
}>()

const expandedFolderIds = ref<Set<number>>(new Set())
const internalSearch = ref('')

const effectiveSearch = computed(() => (props.search ?? internalSearch.value).trim().toLowerCase())

const tree = computed<TreeNode[]>(() => {
  const foldersByParent = new Map<number | null, FolderItem[]>()
  for (const f of props.folders) {
    const list = foldersByParent.get(f.parentId) || []
    list.push(f)
    foldersByParent.set(f.parentId, list)
  }
  const docsByFolder = new Map<number | null, DocumentItem[]>()
  for (const d of props.documents) {
    const list = docsByFolder.get(d.folderId) || []
    list.push(d)
    docsByFolder.set(d.folderId, list)
  }

  function buildFolderNode(f: FolderItem): TreeNode {
    const childFolders = (foldersByParent.get(f.id) || [])
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
      .map(buildFolderNode)
    const childDocs = (docsByFolder.get(f.id) || [])
      .slice()
      .sort((a, b) => a.title.localeCompare(b.title, 'zh'))
      .map<TreeNode>(d => ({
        type: 'document',
        key: `doc:${d.uuid}`,
        name: d.title,
        docUuid: d.uuid,
        updatedAt: d.updatedAt
      }))
    return {
      type: 'folder',
      key: `folder:${f.id}`,
      name: f.name,
      folderId: f.id,
      children: [...childFolders, ...childDocs]
    }
  }

  const rootFolders = (foldersByParent.get(null) || [])
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    .map(buildFolderNode)

  const rootDocs = (docsByFolder.get(null) || [])
    .slice()
    .sort((a, b) => a.title.localeCompare(b.title, 'zh'))
    .map<TreeNode>(d => ({
      type: 'document',
      key: `doc:${d.uuid}`,
      name: d.title,
      docUuid: d.uuid,
      updatedAt: d.updatedAt
    }))

  return [...rootFolders, ...rootDocs]
})

// 过滤：命中搜索词的文档 + 其所有父目录都自动展开
const filteredTree = computed<TreeNode[]>(() => {
  const q = effectiveSearch.value
  if (!q) return tree.value

  const autoExpand = new Set<number>()
  function visit(node: TreeNode, parentFolderIds: number[]): TreeNode | null {
    if (node.type === 'document') {
      return node.name.toLowerCase().includes(q) ? node : null
    }
    const kids = (node.children || [])
      .map(c => visit(c, [...parentFolderIds, node.folderId as number]))
      .filter((n): n is TreeNode => n !== null)
    if (kids.length === 0) return null
    // 命中则自动展开父链
    for (const id of parentFolderIds) autoExpand.add(id)
    autoExpand.add(node.folderId as number)
    return { ...node, children: kids }
  }
  const result = tree.value.map(n => visit(n, [])).filter((n): n is TreeNode => n !== null)
  // merge autoExpand into expandedFolderIds once per render
  for (const id of autoExpand) expandedFolderIds.value.add(id)
  return result
})

// 初次展开所有一级目录（搜索时随 filtered 覆盖）
watch(() => props.folders.length, (n) => {
  if (n > 0 && expandedFolderIds.value.size === 0) {
    for (const f of props.folders) {
      if (f.parentId === null) expandedFolderIds.value.add(f.id)
    }
  }
}, { immediate: true })

function toggleFolder(id: number) {
  if (expandedFolderIds.value.has(id)) expandedFolderIds.value.delete(id)
  else expandedFolderIds.value.add(id)
}

function handleSelect(uuid: string) {
  emit('select', uuid)
}
</script>

<template>
  <div class="space-y-2">
    <UInput
      v-if="search === undefined"
      v-model="internalSearch"
      icon="i-lucide-search"
      size="sm"
      placeholder="按标题搜索文档..."
      class="w-full"
    />

    <div class="rounded-lg border border-default bg-default max-h-48 overflow-y-auto">
      <div v-if="loading" class="flex items-center justify-center py-6 text-muted">
        <UIcon name="i-lucide-loader-2" class="size-4 animate-spin mr-2" />
        加载中...
      </div>
      <div v-else-if="filteredTree.length === 0" class="text-center py-6 text-sm text-muted">
        {{ effectiveSearch ? '未找到匹配文档' : '暂无文档' }}
      </div>
      <ul v-else class="py-1 text-sm">
        <ProjectProposalDocumentTreeNode
          v-for="node in filteredTree"
          :key="node.key"
          :node="node"
          :depth="0"
          :expanded-ids="expandedFolderIds"
          :selected-uuid="selectedUuid"
          @toggle-folder="toggleFolder"
          @select-doc="handleSelect"
        />
      </ul>
    </div>
  </div>
</template>
