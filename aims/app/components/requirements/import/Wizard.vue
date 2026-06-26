<script setup lang="ts">
/**
 * 需求规格书导入弹窗
 * - 统一 AimsDocumentPicker 选择源文档（codocs 项目组文档 / repo 项目仓库文档）
 * - 选中后加载 markdown，自动检测模式（分类/平铺），允许切换
 * - 固定 2 层：功能模块 + 功能项；深层内容合并到功能项 contentMd
 */
import type { OutlineNode } from '~/composables/useMarkdownOutline'
import type { DocumentRef } from '~/composables/useAimsDocumentPicker'
import { fetchRepoDocContent } from '~/composables/useAimsDocumentPicker'
import { renderSafeMarkdown } from '~/utils/safeMarkdown'

const props = defineProps<{
  projectId: number
  /** 初始源文档（由父组件在调用前选好；未传则在 Wizard 内点"选择文档"触发选择器） */
  initialDocRef?: DocumentRef | null
  /** 导入的需求挂接到该 target 工作项（tier=target, type=requirement） */
  workItemId?: number | null
}>()

const emit = defineEmits<{
  close: []
  imported: []
}>()

const toast = useToast()
const { parse, detectDefaultMode } = useMarkdownOutline()
const projectStore = useProjectStore()

const loadingPreview = ref(false)
const submitting = ref(false)

const selectedDocRef = ref<DocumentRef | null>(null)
const rawMarkdown = ref('')
const docTitle = ref('')
const previewHtml = ref('')
const mode = ref<'category' | 'flat'>('flat')
const outlineTree = ref<OutlineNode[]>([])

const showPicker = ref(false)

onMounted(async () => {
  if (!projectStore.currentProject || projectStore.currentProject.id !== props.projectId) {
    await projectStore.fetchProject(props.projectId)
  }
  // 父组件已选好源文档则直接加载预览
  if (props.initialDocRef) {
    selectedDocRef.value = props.initialDocRef
    await loadPreviewFromRef(props.initialDocRef)
  }
})

async function loadPreviewFromRef(docRef: DocumentRef) {
  loadingPreview.value = true
  try {
    let content = ''
    let title = ''
    if (docRef.source === 'codocs' && docRef.codocsUuid) {
      const res = await $fetch<{ code: number, data: { content: string, title: string } }>(
        `/api/v1/codocs/documents/${docRef.codocsUuid}/content`
      )
      if (res.code === 0) {
        content = res.data.content || ''
        title = res.data.title
      }
    } else if (docRef.source === 'repo' && docRef.repoProjectCode && docRef.repoFilePath) {
      const repoDoc = await fetchRepoDocContent(docRef.repoProjectCode, docRef.repoFilePath, {
        commitId: docRef.repoCommitId || undefined
      })
      if (repoDoc) {
        content = repoDoc.content || ''
        title = repoDoc.name
      }
    }

    docTitle.value = title || docRef.title
    rawMarkdown.value = content
    const tree = parse(rawMarkdown.value)
    outlineTree.value = tree
    mode.value = detectDefaultMode(tree)
    previewHtml.value = renderSafeMarkdown(rawMarkdown.value)
  } catch {
    toast.add({ title: '加载预览失败', color: 'error' })
  } finally {
    loadingPreview.value = false
  }
}

function handleDocSelected(docRef: DocumentRef) {
  selectedDocRef.value = docRef
  loadPreviewFromRef(docRef)
}

function openPicker() {
  showPicker.value = true
}

// ---- Collapse to 2 levels based on mode ----
interface CollapsedItem {
  title: string
  headingDepth: number
  contentMd: string
  children: CollapsedItem[]
  category: 'functional' | 'non_functional' | null
}

function extractSelfContent(node: OutlineNode): string {
  // Extract only the node's own body (before first child heading).
  // If no children, return whole body. If child heading can't be located, return empty
  // to avoid duplicating child content (nested loop will re-add it).
  if (!node.bodyMarkdown) return ''
  if (node.children.length === 0) return node.bodyMarkdown.trim()
  const firstChild = node.children[0]!
  const firstChildHeading = `${'#'.repeat(firstChild.depth)} ${firstChild.title}`
  const idx = node.bodyMarkdown.indexOf(firstChildHeading)
  if (idx === -1) return ''
  return node.bodyMarkdown.slice(0, idx).trim()
}

function collapseToItem(node: OutlineNode, itemDepth: number): CollapsedItem {
  // An "item" is the bottom level. Extract its own body + flatten all deeper content into contentMd.
  const selfContent = extractSelfContent(node)
  let finalMd = selfContent

  if (node.children.length > 0) {
    const nested: string[] = []
    for (const child of node.children) {
      const prefix = '#'.repeat(child.depth)
      nested.push(`${prefix} ${child.title}`)
      if (child.bodyMarkdown?.trim()) {
        nested.push(child.bodyMarkdown.trim())
      }
    }
    const nestedMd = nested.join('\n\n')
    finalMd = finalMd ? `${finalMd}\n\n${nestedMd}` : nestedMd
  }

  return {
    title: node.title,
    headingDepth: itemDepth,
    contentMd: finalMd,
    children: [],
    category: null
  }
}

const collapsedTree = computed<CollapsedItem[]>(() => {
  if (!outlineTree.value.length) return []
  const result: CollapsedItem[] = []

  if (mode.value === 'category') {
    // H2 = 分类节点（展示但不可设为需求项），H3 = 模块，H4 = 功能项
    const categoryKeyword = /非功能/
    for (const h2 of outlineTree.value) {
      if (h2.depth !== 2) continue
      const category: 'functional' | 'non_functional' = categoryKeyword.test(h2.title) ? 'non_functional' : 'functional'
      const categoryNode: CollapsedItem = {
        title: h2.title,
        headingDepth: 2,
        contentMd: extractSelfContent(h2),
        children: [],
        category
      }
      for (const h3 of h2.children) {
        if (h3.depth !== 3) continue
        const module: CollapsedItem = {
          title: h3.title,
          headingDepth: 3,
          contentMd: extractSelfContent(h3),
          children: [],
          category
        }
        for (const h4 of h3.children) {
          if (h4.depth !== 4) continue
          module.children.push(collapseToItem(h4, 4))
        }
        categoryNode.children.push(module)
      }
      result.push(categoryNode)
    }
  } else {
    // H2 = module, H3 = item
    for (const h2 of outlineTree.value) {
      if (h2.depth !== 2) continue
      const module: CollapsedItem = {
        title: h2.title,
        headingDepth: 2,
        contentMd: extractSelfContent(h2),
        children: [],
        category: 'functional'
      }
      for (const h3 of h2.children) {
        if (h3.depth !== 3) continue
        module.children.push(collapseToItem(h3, 3))
      }
      result.push(module)
    }
  }

  return result
})

const moduleCount = computed(() => {
  if (mode.value === 'category') {
    // 分类模式下模块 = 所有 H3
    return collapsedTree.value.reduce((sum, cat) => sum + cat.children.length, 0)
  }
  return collapsedTree.value.length
})
const itemCount = computed(() => {
  if (mode.value === 'category') {
    let count = 0
    for (const cat of collapsedTree.value) {
      for (const mod of cat.children) {
        count += mod.children.length || 1
      }
    }
    return count
  }
  return collapsedTree.value.reduce((sum, m) => sum + (m.children.length || 1), 0)
})

// ---- Submit ----
interface ImportItem {
  title: string
  headingDepth: number
  contentMd: string | null
  children: ImportItem[]
  asRequirement: boolean
  mergeGroupId: string | null
  requirementType: string
  requirementCategory: string | null
}

function toImportItems(items: CollapsedItem[]): ImportItem[] {
  return items.map(item => ({
    title: item.title,
    headingDepth: item.headingDepth,
    contentMd: item.contentMd || null,
    children: item.children.length > 0 ? toImportItems(item.children) : [],
    asRequirement: false,
    mergeGroupId: null,
    requirementType: item.category === 'non_functional' ? 'non_functional' : 'functional',
    requirementCategory: item.category
  }))
}

async function doImport(forceOverwrite = false) {
  const docRef = selectedDocRef.value
  if (!docRef) throw new Error('未选择源文档')
  return await $fetch<{ code: number, data: { contentsCreated: number, requirementsCreated: number } }>(
    `/api/v1/projects/${props.projectId}/requirements/import`,
    {
      method: 'POST',
      body: {
        source: docRef.source,
        codocsUuid: docRef.source === 'codocs' ? docRef.codocsUuid : null,
        repoProjectCode: docRef.source === 'repo' ? docRef.repoProjectCode : null,
        repoFilePath: docRef.source === 'repo' ? docRef.repoFilePath : null,
        repoCommitId: docRef.source === 'repo' ? docRef.repoCommitId : null,
        docName: docTitle.value,
        mode: mode.value,
        headingLevels: mode.value === 'category' ? '3,4' : '2,3',
        items: toImportItems(collapsedTree.value),
        workItemId: props.workItemId ?? undefined,
        forceOverwrite
      }
    }
  )
}

async function handleImport() {
  submitting.value = true
  try {
    const res = await doImport(false)
    if (res?.code === 0) {
      toast.add({
        title: `导入成功：${moduleCount.value} 个模块，${itemCount.value} 个功能项`,
        color: 'success'
      })
      emit('imported')
    }
  } catch (err: unknown) {
    const errData = (err as { data?: { data?: { requireConfirm?: boolean } } })?.data?.data
    if (errData?.requireConfirm) {
      if (confirm('存在已有需求项，重新导入将删除所有草稿态需求。确认覆盖？')) {
        try {
          const res = await doImport(true)
          if (res?.code === 0) {
            toast.add({ title: `重新导入成功：${moduleCount.value} 个模块`, color: 'success' })
            emit('imported')
          }
        } catch {
          toast.add({ title: '重新导入失败', color: 'error' })
        }
      }
    } else {
      const msg = (err as { data?: { message?: string } })?.data?.message || '导入失败'
      toast.add({ title: msg, color: 'error' })
    }
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    :open="true"
    :ui="{ content: 'sm:max-w-3xl' }"
    @update:open="(v: boolean) => !v && emit('close')"
  >
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-upload" class="size-5 text-primary" />
        <span class="font-semibold">导入需求规格书</span>
      </div>
    </template>

    <template #body>
      <div class="space-y-4">
        <!-- 源文档（点击打开统一选择器） -->
        <div class="flex items-center gap-3 p-3 rounded-lg border border-default">
          <UIcon name="i-lucide-file-text" class="size-5 shrink-0" :class="selectedDocRef ? 'text-primary' : 'text-muted'" />
          <div class="flex-1 min-w-0">
            <div v-if="selectedDocRef" class="text-sm font-medium truncate">
              {{ docTitle || selectedDocRef.title }}
            </div>
            <div v-else class="text-sm text-muted">
              尚未选择源文档
            </div>
            <div v-if="selectedDocRef" class="text-xs text-dimmed font-mono truncate">
              <template v-if="selectedDocRef.source === 'repo'">
                仓库 · {{ selectedDocRef.repoProjectCode }} · {{ selectedDocRef.repoFilePath }}
                <span v-if="selectedDocRef.repoCommitId"> @ {{ selectedDocRef.repoCommitId.slice(0, 8) }}</span>
              </template>
              <template v-else>
                项目组文档 · {{ selectedDocRef.codocsUuid?.slice(0, 8) }}
              </template>
            </div>
          </div>
          <UButton
            :label="selectedDocRef ? '更换' : '选择文档'"
            :icon="selectedDocRef ? 'i-lucide-refresh-cw' : 'i-lucide-file-search'"
            color="primary"
            variant="soft"
            size="sm"
            @click="openPicker"
          />
        </div>

        <!-- Mode + stats -->
        <div
          v-if="outlineTree.length > 0"
          class="flex items-center gap-3 p-3 rounded-lg bg-elevated"
        >
          <span class="text-sm text-muted">解析为:</span>
          <UButton
            :color="mode === 'category' ? 'primary' : 'neutral'"
            :variant="mode === 'category' ? 'soft' : 'ghost'"
            size="xs"
            label="分类模式 (H3 模块 / H4 功能项)"
            @click="mode = 'category'"
          />
          <UButton
            :color="mode === 'flat' ? 'primary' : 'neutral'"
            :variant="mode === 'flat' ? 'soft' : 'ghost'"
            size="xs"
            label="平铺模式 (H2 模块 / H3 功能项)"
            @click="mode = 'flat'"
          />
          <div class="flex-1" />
          <UBadge
            color="info"
            variant="subtle"
            size="xs"
          >
            {{ moduleCount }} 模块 / {{ itemCount }} 项
          </UBadge>
        </div>

        <!-- Preview -->
        <div
          v-if="loadingPreview"
          class="flex justify-center py-12"
        >
          <UIcon name="i-lucide-loader-2" class="w-6 h-6 animate-spin text-muted" />
        </div>
        <div
          v-else-if="previewHtml"
          class="max-h-[45vh] overflow-y-auto border border-default rounded-lg p-4"
        >
          <div class="text-xs text-muted mb-2">
            文档预览: {{ docTitle }}
          </div>
          <!-- Markdown is rendered through safeMarkdown before injection. -->
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div class="import-preview-md text-sm max-w-none" v-html="previewHtml" />
        </div>
        <div
          v-else-if="selectedDocRef"
          class="text-center py-8 text-muted text-sm"
        >
          文档内容为空
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex items-center justify-between w-full">
        <UButton
          label="取消"
          color="neutral"
          variant="ghost"
          @click="emit('close')"
        />
        <UButton
          icon="i-lucide-check"
          label="确认导入"
          color="primary"
          :disabled="!selectedDocRef || !previewHtml || outlineTree.length === 0"
          :loading="submitting"
          @click="handleImport"
        />
      </div>
    </template>
  </UModal>

  <!-- 源文档选择器（嵌套 modal） -->
  <AimsDocumentPicker
    v-model:open="showPicker"
    title="选择源文档（原始需求书）"
    :dept-code="projectStore.currentProject?.deptCode || null"
    :aims-project-id="projectId"
    :repos="projectStore.currentProject?.repos || []"
    :initial-value="selectedDocRef"
    default-source="repo"
    mode="snapshot"
    @select="handleDocSelected"
  />
</template>

<style scoped>
.import-preview-md :deep(h1), .import-preview-md :deep(h2), .import-preview-md :deep(h3), .import-preview-md :deep(h4) { font-weight: 600; margin-top: 1em; margin-bottom: 0.5em; }
.import-preview-md :deep(h1) { font-size: 1.5rem; }
.import-preview-md :deep(h2) { font-size: 1.25rem; }
.import-preview-md :deep(h3) { font-size: 1.1rem; }
.import-preview-md :deep(p) { margin: 0.5em 0; }
.import-preview-md :deep(ul), .import-preview-md :deep(ol) { margin: 0.5em 0; padding-left: 1.5em; }
.import-preview-md :deep(ul) { list-style-type: disc; }
.import-preview-md :deep(ol) { list-style-type: decimal; }
.import-preview-md :deep(li) { margin: 0.25em 0; }
.import-preview-md :deep(table) { border-collapse: collapse; width: 100%; margin: 0.75em 0; }
.import-preview-md :deep(th), .import-preview-md :deep(td) { border: 1px solid var(--ui-border); padding: 0.4em 0.75em; }
.import-preview-md :deep(th) { background: var(--ui-bg-elevated); font-weight: 600; }
</style>
