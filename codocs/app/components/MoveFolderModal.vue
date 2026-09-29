<script setup lang="ts">
/**
 * 移动文档到指定文件夹的模态框组件
 * 展示文件夹树形结构，支持选择目标文件夹
 */

interface FolderItem {
  id: number
  name: string
  parent_id: number | null
}

interface TreeFolder {
  id: number
  name: string
  parent_id: number | null
  children: TreeFolder[]
}

interface Props {
  open: boolean
  folders: FolderItem[]
  currentFolderId: number | null
  docTitle?: string
  loadPage?: (parentId: number | null, page: number) => Promise<{ items: FolderItem[], total: number, page: number, pageSize: number, parentChain: { id: number, name: string }[] }>
}

const props = withDefaults(defineProps<Props>(), {
  docTitle: ''
})

const emit = defineEmits<{
  'update:open': [value: boolean]
  'confirm': [folderId: number | null]
}>()

// 选中的目标文件夹 ID
const selectedFolderId = ref<number | null>(null)
const browseParentId = ref<number | null>(null)
const browsePage = ref(1)
const browseFolders = ref<FolderItem[]>([])
const browseTotal = ref(0)
const browseChain = ref<{ id: number, name: string }[]>([])
const browseLoading = ref(false)
const browseError = ref('')
let browseSequence = 0
async function browse(parentId: number | null, page = 1) {
  if (!props.loadPage) return
  const request = ++browseSequence
  browseParentId.value = parentId
  browsePage.value = page
  browseLoading.value = true
  browseError.value = ''
  try {
    const result = await props.loadPage(parentId, page)
    if (request !== browseSequence || !props.open) return
    browseFolders.value = result.items
    browseTotal.value = result.total
    browseChain.value = result.parentChain
  } catch {
    if (request !== browseSequence || !props.open) return
    browseFolders.value = []
    browseTotal.value = 0
    browseError.value = '目标目录加载失败，请重试'
  } finally {
    if (request === browseSequence) browseLoading.value = false
  }
}
function browseFolder(folder: FolderItem) {
  selectedFolderId.value = folder.id
  void browse(folder.id)
}
function browseAncestor(id: number | null) {
  selectedFolderId.value = id
  void browse(id)
}

// 展开的文件夹集合
const expandedIds = ref<Set<number>>(new Set())

// 当模态框打开时重置状态
watch(() => props.open, (newVal) => {
  if (newVal) {
    selectedFolderId.value = null
    if (props.loadPage) void browse(null)
    // 默认展开所有文件夹
    const allIds = new Set<number>()
    props.folders.forEach(f => allIds.add(f.id))
    expandedIds.value = allIds
  } else ++browseSequence
})

// 构建文件夹树
const buildFolderTree = (parentId: number | null): TreeFolder[] => {
  return props.folders
    .filter(f => f.parent_id === parentId)
    .map(f => ({
      ...f,
      children: buildFolderTree(f.id)
    }))
}

const folderTree = computed(() => buildFolderTree(null))

// 切换文件夹展开/折叠
const toggleExpand = (folderId: number) => {
  const newSet = new Set(expandedIds.value)
  if (newSet.has(folderId)) {
    newSet.delete(folderId)
  } else {
    newSet.add(folderId)
  }
  expandedIds.value = newSet
}

// 选中文件夹
const selectFolder = (folderId: number | null) => {
  // 不允许选中当前所在的文件夹
  if (folderId === props.currentFolderId) return
  selectedFolderId.value = folderId
}

// 确认移动
const confirmMove = () => {
  emit('confirm', selectedFolderId.value)
  emit('update:open', false)
}

// 关闭
const close = () => {
  emit('update:open', false)
}

// 判断当前文件夹是否可选（不能选择当前所在的文件夹）
const isDisabled = (folderId: number | null) => {
  return folderId === props.currentFolderId
}
</script>

<template>
  <UModal :open="open" :ui="{ content: 'w-120' }" @update:open="emit('update:open', $event)">
    <template #content>
      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h3 class="text-lg font-semibold">
              移动文档
            </h3>
            <UButton
              icon="i-lucide-x"
              color="neutral"
              variant="ghost"
              @click="close"
            />
          </div>
          <p v-if="docTitle" class="text-sm text-muted mt-1">
            移动 "{{ docTitle }}" 到：
          </p>
        </template>

        <div class="max-h-80 overflow-y-auto -mx-2">
          <!-- 根目录选项 -->
          <div
            class="flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors mx-2"
            :class="{
              'bg-primary/10 text-primary font-medium': selectedFolderId === null && !isDisabled(null),
              'opacity-50 cursor-not-allowed': isDisabled(null),
              'hover:bg-elevated': !isDisabled(null) && selectedFolderId !== null
            }"
            @click="selectFolder(null)"
          >
            <UIcon name="i-lucide-home" class="w-4 h-4 shrink-0" />
            <span class="text-sm">根目录</span>
            <span v-if="isDisabled(null)" class="text-xs text-muted ml-auto">（当前位置）</span>
          </div>

          <template v-if="loadPage">
            <div class="flex flex-wrap gap-1 px-3 py-2 text-xs text-muted">
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                @click="browseAncestor(null)"
              >
                根目录
              </UButton>
              <UButton
                v-for="part in browseChain"
                :key="part.id"
                size="xs"
                color="neutral"
                variant="ghost"
                @click="browseAncestor(part.id)"
              >
                {{ part.name }}
              </UButton>
            </div>
            <p v-if="browseLoading" class="px-3 py-2 text-xs text-muted">
              正在加载目标目录…
            </p>
            <UAlert v-else-if="browseError" color="error" :title="browseError" />
            <div v-else>
              <UButton
                v-for="folder in browseFolders"
                :key="folder.id"
                class="w-full justify-start"
                color="neutral"
                variant="ghost"
                icon="i-lucide-folder"
                @click="browseFolder(folder)"
              >
                {{ folder.name }}
              </UButton>
              <p v-if="browseFolders.length === 0" class="px-3 py-2 text-xs text-muted">
                此级没有子目录
              </p>
              <div v-if="browseTotal > 20" class="px-3 py-2 text-xs text-muted" @click.stop>
                <span>共 {{ browseTotal }} 个子目录</span>
                <UPagination
                  :page="browsePage"
                  :total="browseTotal"
                  :items-per-page="20"
                  :sibling-count="0"
                  show-edges
                  @update:page="browse(browseParentId, $event)"
                />
              </div>
            </div>
          </template>
          <!-- Legacy full tree remains for other folder namespaces. -->
          <MoveFolderTreeNode
            v-for="folder in folderTree"
            v-else
            :key="folder.id"
            :folder="folder"
            :level="1"
            :selected-id="selectedFolderId"
            :expanded-ids="expandedIds"
            :disabled-id="currentFolderId"
            @select="selectFolder"
            @toggle="toggleExpand"
          />
        </div>

        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton color="neutral" variant="outline" @click="close">
              取消
            </UButton>
            <UButton
              color="primary"
              :disabled="isDisabled(selectedFolderId) || Boolean(loadPage && (browseLoading || browseError))"
              @click="confirmMove"
            >
              确定移动
            </UButton>
          </div>
        </template>
      </UCard>
    </template>
  </UModal>
</template>
