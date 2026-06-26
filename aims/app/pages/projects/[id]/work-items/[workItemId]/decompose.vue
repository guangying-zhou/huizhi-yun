<script setup lang="ts">
/**
 * 需求分解页
 *
 * 从 Codocs 需求文档提取 H2–H4 标题，用户勾选章节批量生成 work_items。
 * 支持分类模式（H2=分类, H3=target, H4=task）与平铺模式（H2=target, H3=task）。
 * target 行级可选"拆分为任务"或"直转任务"。
 * 子任务支持合并打包。
 * 已分解锚点自动锁定，支持增量分解。
 *
 * 详见 docs/Aims-Requirement-Decomposition-Design.md
 */
import { useMarkdownOutline, type OutlineNode } from '~/composables/useMarkdownOutline'
import type {
  DecomposeMode as Mode,
  RequirementCategory,
  UiNode
} from '~/types/decompose'

definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '需求分解',
  layoutHeaderProjectSwitcher: false
})

interface DecomposeContext {
  workItem: {
    id: number
    itemKey: string
    title: string
    tier: string
    type: string
    templateKey: string
    status: string
    approvalStatus: string
    reviewLevel: number
    projectId: number
    projectCode: string
    projectName: string
    milestoneId: number
    milestoneName: string
  }
  sourceProjectCodes: string[]
  sourceDocumentCandidates: Array<{
    codocsUuid: string
    title: string
    ownerUid: string
    projectCode: string | null
    sourceProjectCode: string
    updatedAt: string
  }>
  existingAnchors: Array<{
    anchor: string
    sourceDocumentUuid: string
    sourceDocumentTitle: string
    headingDepth: number
    workItemId: number
    workItemKey: string
    workItemTier: string
    workItemParentId: number | null
    workItemRequirementCategory: string | null
  }>
}

interface DocContentResponse {
  code: number
  data: {
    uuid: string
    title: string
    content: string
    updatedAt: string
  }
}

// ---------- 基础状态 ----------
const route = useRoute()
const router = useRouter()
const toast = useToast()

const projectId = computed(() => Number(route.params.id))
const workItemId = computed(() => Number(route.params.workItemId))

const loadingContext = ref(false)
const loadingContent = ref(false)
const context = ref<DecomposeContext | null>(null)
const selectedDocUuid = ref<string>('')
const rawMarkdown = ref<string>('')
const mode = ref<Mode>('flat')
const outline = ref<UiNode[]>([])

// 源文档选择弹窗状态
const showDocPickerModal = ref(false)
const showDocPreviewModal = ref(false)
const docDraftUuid = ref<string>('')

const selectedDoc = computed(() => {
  if (!context.value || !selectedDocUuid.value) return null
  return context.value.sourceDocumentCandidates.find(d => d.codocsUuid === selectedDocUuid.value) || null
})

const draftDoc = computed(() => {
  if (!context.value || !docDraftUuid.value) return null
  return context.value.sourceDocumentCandidates.find(d => d.codocsUuid === docDraftUuid.value) || null
})

function openDocPicker() {
  docDraftUuid.value = selectedDocUuid.value || ''
  showDocPickerModal.value = true
}

function confirmDocPick() {
  if (!docDraftUuid.value) return
  selectedDocUuid.value = docDraftUuid.value
  showDocPickerModal.value = false
}

const { parse, detectDefaultMode } = useMarkdownOutline()

function flattenUiNodes(nodes: UiNode[]): UiNode[] {
  const result: UiNode[] = []
  const walk = (list: UiNode[]) => {
    for (const node of list) {
      result.push(node)
      walk(node.children)
    }
  }
  walk(nodes)
  return result
}

// ---------- 辅助：创建 UI 节点 ----------
function toUiNode(node: OutlineNode, existingAnchors: Map<string, DecomposeContext['existingAnchors'][number]>): UiNode {
  const locked = existingAnchors.has(node.anchor)
  const lockedInfo = locked ? existingAnchors.get(node.anchor) : undefined
  return {
    key: node.id,
    depth: node.depth,
    title: node.title,
    anchor: node.anchor,
    bodyMarkdown: node.bodyMarkdown,
    children: node.children.map(c => toUiNode(c, existingAnchors)),
    locked,
    lockedWorkItemKey: lockedInfo?.workItemKey,
    selected: false,
    targetMode: 'split',
    deliverableType: 'code',
    priority: 'P2',
    packBundleId: null,
    categoryLabel: undefined,
    categoryEnabled: false
  }
}

// ---------- 加载分解上下文 ----------
async function loadContext() {
  loadingContext.value = true
  try {
    const res = await $fetch<{ code: number, data: DecomposeContext }>(
      `/api/v1/work-items/${workItemId.value}/decompose-context`
    )
    context.value = res.data
    if (res.data.sourceDocumentCandidates.length > 0) {
      selectedDocUuid.value = res.data.sourceDocumentCandidates[0]!.codocsUuid
    }
  } catch (error: unknown) {
    const msg = (error as { data?: { message?: string } })?.data?.message || (error as Error).message
    toast.add({ title: '加载上下文失败', description: msg, color: 'error' })
  } finally {
    loadingContext.value = false
  }
}

// ---------- 加载并解析文档内容 ----------
async function loadDocumentContent() {
  if (!selectedDocUuid.value) return
  loadingContent.value = true
  try {
    const res = await $fetch<DocContentResponse>(
      `/api/v1/codocs/documents/${selectedDocUuid.value}/content`
    )
    rawMarkdown.value = res.data.content || ''
    if (!rawMarkdown.value) {
      toast.add({ title: '文档内容为空', description: '该文档在 Codocs 中还没有内容', color: 'warning' })
    }
    rebuildOutline()
    if (rawMarkdown.value && outline.value.length === 0) {
      toast.add({
        title: '未提取到任何标题',
        description: '文档中没有 H1–H6 级别的标题。请在 Codocs 里先用标题划分章节。',
        color: 'warning'
      })
    } else if (rawMarkdown.value && h2Nodes.value.length === 0) {
      // 有标题但没有 H2，给出明确提示
      const flat = flattenUiNodes(outline.value)
      const depths = flat.reduce<Record<number, number>>((acc, n) => {
        acc[n.depth] = (acc[n.depth] || 0) + 1
        return acc
      }, {})
      const summary = Object.entries(depths).map(([d, c]) => `H${d}×${c}`).join(' / ')
      toast.add({
        title: '文档里没有 H2 级标题',
        description: `目前解析到：${summary}。需求分解需要至少一个 H2 标题作为需求/分类根节点。`,
        color: 'warning'
      })
    }
  } catch (error: unknown) {
    const msg = (error as { data?: { message?: string } })?.data?.message || (error as Error).message
    toast.add({ title: '加载文档内容失败', description: msg, color: 'error' })
    rawMarkdown.value = ''
    outline.value = []
  } finally {
    loadingContent.value = false
  }
}

// ---------- 重建 UI 大纲 ----------
function rebuildOutline() {
  if (!rawMarkdown.value || !context.value) {
    outline.value = []
    return
  }
  const parsed = parse(rawMarkdown.value)
  const existingForDoc = new Map<string, DecomposeContext['existingAnchors'][number]>()
  for (const a of context.value.existingAnchors) {
    if (a.sourceDocumentUuid === selectedDocUuid.value) {
      existingForDoc.set(a.anchor, a)
    }
  }
  const uiNodes = parsed.map(n => toUiNode(n, existingForDoc))
  // 自动检测模式（仅在用户未手动切换前）
  const detected = detectDefaultMode(parsed)
  mode.value = detected
  outline.value = uiNodes
}

watch(selectedDocUuid, () => {
  if (selectedDocUuid.value) loadDocumentContent()
})

onMounted(async () => {
  await loadContext()
})

// ---------- 模式切换 ----------
function switchMode(next: Mode) {
  if (next === mode.value) return
  // 清空当前勾选
  resetSelections(outline.value)
  mode.value = next
}

function resetSelections(nodes: UiNode[]) {
  for (const n of nodes) {
    n.selected = false
    n.categoryEnabled = false
    n.categoryLabel = undefined
    n.targetMode = 'split'
    n.packBundleId = null
    resetSelections(n.children)
  }
}

// ---------- 计算：有哪些 H2（用于分类模式的类别选择）----------
// 从整棵大纲树里找出所有 depth=2 的节点，不限顶层
// 支持文档结构是 "# 标题 → ## xxx" 这种 H1 包裹 H2 的情况
const h2Nodes = computed(() => flattenUiNodes(outline.value).filter(n => n.depth === 2))

// ---------- 计算：有多少条将被创建 ----------
// 语义：
//   - targetCount = 目标（tier=target）条数，每个被选中的 H2 各占 1 条
//   - taskCount   = 开发任务（tier=matter）条数：
//     * 拆分模式：=勾选的 H3 条数（合并束算一条）
//     * 直转模式：=1（复制自目标本身）
//
// BuildItem 保留对原始 UiNode 的引用，供右侧预览面板直接 v-model 编辑
// 优先级/交付物类型（避免把状态分散到预览副本里）
interface BuildTask {
  nodes: UiNode[] // 合并束中的所有子节点（非合并时 length=1）
  title: string
  sourceAnchors: Array<{ headingAnchor: string, headingDepth: 3 | 4 }>
}

interface BuildItem {
  targetNode: UiNode // H2（flat 模式）或 H3（category 模式）
  category: RequirementCategory | null
  kind: 'target_with_tasks' | 'direct_task'
  title: string
  headingAnchor: string
  headingDepth: 2 | 3
  tasks: BuildTask[]
}

interface BuildSummary {
  targetCount: number
  taskCount: number
  items: BuildItem[]
}

function buildSubmission(): BuildSummary {
  const result: BuildSummary = { targetCount: 0, taskCount: 0, items: [] }

  if (mode.value === 'category') {
    // H2 被标记为分类 → 下面的 H3 是 target，H4 是 task
    for (const h2 of h2Nodes.value) {
      const category = h2.categoryLabel
      if (!h2.categoryEnabled || !category) continue
      for (const h3 of h2.children.filter(c => c.depth === 3 && !c.locked && c.selected)) {
        pushRequirement(result, h3, category, 3)
      }
    }
  } else {
    // 平铺：H2 = target, H3 = task
    for (const h2 of h2Nodes.value) {
      if (!h2.selected || h2.locked) continue
      pushRequirement(result, h2, null, 2)
    }
  }

  return result
}

function pushRequirement(
  result: BuildSummary,
  targetNode: UiNode,
  category: RequirementCategory | null,
  depth: 2 | 3
) {
  const children = targetNode.children.filter(c => !c.locked && c.selected)
  const kind: 'target_with_tasks' | 'direct_task' = targetNode.targetMode === 'direct' || children.length === 0
    ? 'direct_task'
    : 'target_with_tasks'

  // 无论 kind 如何，每个选中的 H2 都会建一条 target
  result.targetCount += 1

  if (kind === 'direct_task') {
    result.taskCount += 1
    result.items.push({
      targetNode,
      category,
      kind: 'direct_task',
      title: targetNode.title,
      headingAnchor: targetNode.anchor,
      headingDepth: depth,
      tasks: [{
        nodes: [targetNode],
        title: targetNode.title,
        sourceAnchors: [{ headingAnchor: targetNode.anchor, headingDepth: depth as 3 | 4 }]
      }]
    })
    return
  }

  // 按 packBundleId 分组
  type Bundle = { bundleId: string | null, items: UiNode[] }
  const bundles: Bundle[] = []
  for (const child of children) {
    const bundleId = child.packBundleId
    if (bundleId) {
      const existing = bundles.find(b => b.bundleId === bundleId)
      if (existing) {
        existing.items.push(child)
        continue
      }
    }
    bundles.push({ bundleId, items: [child] })
  }

  const tasks: BuildTask[] = []
  for (const bundle of bundles) {
    result.taskCount += 1
    const title = bundle.items.length === 1
      ? bundle.items[0]!.title
      : `${bundle.items[0]!.title} 等 ${bundle.items.length} 项`
    tasks.push({
      nodes: bundle.items,
      title,
      sourceAnchors: bundle.items.map(it => ({
        headingAnchor: it.anchor,
        headingDepth: it.depth as 3 | 4
      }))
    })
  }

  result.items.push({
    targetNode,
    category,
    kind: 'target_with_tasks',
    title: targetNode.title,
    headingAnchor: targetNode.anchor,
    headingDepth: depth,
    tasks
  })
}

const summary = computed(() => buildSubmission())
const canSubmit = computed(() => summary.value.items.length > 0 && !submitting.value)

// ---------- 打包合并 ----------
// 只合并"已勾选且尚未归入任何 bundle"的子项；已在 bundle 中的保持不动
function packSelected(parent: UiNode) {
  const targets = parent.children.filter(
    c => c.selected && !c.locked && !c.packBundleId
  )
  if (targets.length < 2) {
    toast.add({ title: '至少选 2 个未合并的子项才能合并', color: 'warning' })
    return
  }
  const bundleId = `bundle-${Date.now()}`
  for (const t of targets) t.packBundleId = bundleId
}

function unpack(parent: UiNode, bundleId: string) {
  for (const c of parent.children) {
    if (c.packBundleId === bundleId) c.packBundleId = null
  }
}

// ---------- 级联选中父级 ----------
function onChildSelectChange(parent: UiNode, child: UiNode) {
  if (child.selected && !parent.selected && !parent.locked) {
    parent.selected = true
  }
}

// ---------- 提交对话框 ----------
const submitDialogOpen = ref(false)
const submitting = ref(false)
const submitForm = reactive({
  workHours: 0.5,
  submitNote: ''
})

function openSubmitDialog() {
  if (!canSubmit.value) {
    toast.add({ title: '请先勾选至少一项', color: 'warning' })
    return
  }
  submitDialogOpen.value = true
}

async function doSubmit() {
  if (submitting.value || !context.value) return
  if (!(submitForm.workHours > 0)) {
    toast.add({ title: '请填写实际投入工时', color: 'warning' })
    return
  }
  const doc = context.value.sourceDocumentCandidates.find(d => d.codocsUuid === selectedDocUuid.value)
  if (!doc) {
    toast.add({ title: '源文档信息丢失', color: 'error' })
    return
  }
  submitting.value = true
  try {
    // 把 BuildItem 序列化为后端期望的 payload 结构
    // 注意：从 targetNode/nodes 里读出 priority 和 deliverableType（右侧预览卡编辑的就是它们）
    const serializedItems = summary.value.items.map(item => ({
      category: item.category,
      kind: item.kind,
      title: item.title,
      headingAnchor: item.headingAnchor,
      headingDepth: item.headingDepth,
      priority: item.targetNode.priority,
      assigneeUid: null,
      estimatedHours: null,
      tasks: item.tasks.map(task => ({
        title: task.title,
        sourceAnchors: task.sourceAnchors,
        priority: task.nodes[0]?.priority || item.targetNode.priority,
        assigneeUid: null,
        estimatedHours: null,
        deliverableType: task.nodes[0]?.deliverableType || 'code'
      }))
    }))

    const payload = {
      mode: mode.value,
      sourceDocumentUuid: selectedDocUuid.value,
      sourceDocumentTitle: doc.title,
      workHours: submitForm.workHours,
      submitNote: submitForm.submitNote || undefined,
      items: serializedItems
    }
    const res = await $fetch<{ code: number, data: { createdWorkItems: unknown[], sourceWorkItemStatus: string } }>(
      `/api/v1/work-items/${workItemId.value}/decompose-submit`,
      { method: 'POST', body: payload }
    )
    toast.add({
      title: '分解提交成功',
      description: `已生成 ${res.data.createdWorkItems.length} 条工作项，源工作项状态：${res.data.sourceWorkItemStatus}`,
      color: 'success'
    })
    submitDialogOpen.value = false
    // 跳回工作项详情页
    navigateTo(`/projects/${projectId.value}/board/${workItemId.value}/execution`)
  } catch (error: unknown) {
    const msg = (error as { data?: { message?: string } })?.data?.message || (error as Error).message
    toast.add({ title: '提交失败', description: msg, color: 'error' })
  } finally {
    submitting.value = false
  }
}

// ---------- 取消 ----------
function onCancel() {
  router.back()
}
</script>

<template>
  <div class="w-full h-full flex flex-col overflow-hidden">
    <!-- 顶部区：上下文 + 源文档紧凑工具栏（不随内容滚动） -->
    <div class="shrink-0 px-6 pt-4 pb-2 space-y-3">
      <!-- 上下文（单行紧凑） -->
      <div v-if="context" class="flex flex-wrap items-center gap-3 px-3 py-2 rounded-lg border border-default bg-elevated/40 text-sm">
        <div class="flex items-center gap-1.5">
          <span class="text-xs text-muted">容器</span>
          <span class="font-semibold">{{ context.workItem.itemKey }} · {{ context.workItem.title }}</span>
        </div>
        <UDivider orientation="vertical" class="h-4" />
        <div class="flex items-center gap-1.5">
          <span class="text-xs text-muted">项目</span>
          <span>{{ context.workItem.projectName }}</span>
        </div>
        <UDivider orientation="vertical" class="h-4" />
        <div class="flex items-center gap-1.5">
          <span class="text-xs text-muted">里程碑</span>
          <span>{{ context.workItem.milestoneName }}</span>
        </div>
      </div>

      <!-- 源文档工具栏 -->
      <div v-if="context" class="flex items-center gap-3 px-3 py-2 rounded-lg border border-default bg-elevated/40">
        <!-- 已选中 -->
        <template v-if="selectedDoc">
          <UIcon name="i-lucide-file-text" class="size-5 text-primary shrink-0" />
          <button
            class="min-w-0 flex-1 text-left hover:opacity-80 transition-opacity"
            @click="showDocPreviewModal = true"
          >
            <div class="text-sm font-medium truncate">
              {{ selectedDoc.title }}
            </div>
            <div class="text-xs text-muted truncate">
              来自项目组 {{ selectedDoc.sourceProjectCode }} · 点击全屏预览
            </div>
          </button>
          <UFormField v-if="rawMarkdown" class="shrink-0 !mb-0">
            <URadioGroup
              :model-value="mode"
              :items="[
                { label: '分类模式', value: 'category' },
                { label: '平铺模式', value: 'flat' }
              ]"
              orientation="horizontal"
              @update:model-value="v => switchMode(v as Mode)"
            />
          </UFormField>
          <UButton
            icon="i-lucide-folder-sync"
            label="变更"
            color="neutral"
            variant="subtle"
            size="xs"
            @click="openDocPicker"
          />
        </template>

        <!-- 未选中 -->
        <template v-else>
          <UIcon name="i-lucide-file-search" class="size-5 text-muted shrink-0" />
          <div class="min-w-0 flex-1 text-sm">
            <template v-if="context.sourceProjectCodes.length === 0">
              <span class="text-warning">⚠ 该项目未绑定项目集或未关联任何 GitLab 仓库，无法定位项目组文档</span>
            </template>
            <template v-else-if="context.sourceDocumentCandidates.length === 0">
              <span class="text-warning">⚠ 候选项目组（{{ context.sourceProjectCodes.join('、') }}）下未找到任何 Codocs 文档</span>
            </template>
            <template v-else>
              <span class="text-muted">已检索项目组：{{ context.sourceProjectCodes.join('、') }}；共找到 {{ context.sourceDocumentCandidates.length }} 份文档</span>
            </template>
          </div>
          <UButton
            icon="i-lucide-folder-search"
            label="选择源文档"
            color="primary"
            variant="soft"
            size="xs"
            :disabled="context.sourceDocumentCandidates.length === 0"
            @click="openDocPicker"
          />
        </template>
      </div>
    </div>

    <!-- 中部：左右分栏 -->
    <div class="flex-1 min-h-0 flex gap-4 px-6 pb-2 overflow-hidden">
      <!-- 左：需求标题树（可交互） -->
      <UCard
        class="flex-1 min-w-0 flex flex-col"
        :ui="{ body: 'flex-1 min-h-0 overflow-y-auto' }"
      >
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-list-tree" class="size-4 text-primary" />
            <span class="font-semibold">需求文档</span>
            <span v-if="selectedDoc" class="text-xs text-muted truncate">· {{ selectedDoc.title }}</span>
          </div>
        </template>

        <!-- 内容加载状态 -->
        <div v-if="selectedDoc && loadingContent" class="flex items-center justify-center gap-2 text-sm text-muted py-16">
          <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
          正在读取文档内容并解析大纲...
        </div>

        <!-- 未选中源文档 -->
        <div v-else-if="!selectedDoc" class="h-full flex items-center justify-center text-sm text-muted p-6">
          请先在上方选择源文档
        </div>

        <!-- 文档空或无标题 -->
        <div v-else-if="!rawMarkdown" class="h-full flex items-center justify-center text-sm text-warning p-6">
          ⚠ 文档内容为空或读取失败
        </div>
        <div v-else-if="outline.length === 0" class="h-full flex items-center justify-center text-sm text-muted p-6">
          未能从文档中提取到任何 H2–H6 标题
        </div>

        <!-- 分类模式：先选 H2 为分类 -->
        <div v-else-if="mode === 'category'" class="space-y-4">
          <div class="space-y-2">
            <div class="text-xs font-medium text-muted uppercase tracking-wide">
              步骤 1：选择 H2 作为需求分类
            </div>
            <div
              v-for="h2 in h2Nodes"
              :key="h2.key"
              class="flex items-center gap-3 rounded border border-default px-3 py-2"
              :class="h2.categoryEnabled ? 'bg-primary/5' : ''"
            >
              <UCheckbox v-model="h2.categoryEnabled" :disabled="h2.locked" />
              <!-- <span class="font-mono text-xs text-muted">H2</span> -->
              <span class="flex-1 text-sm">{{ h2.title }}</span>
              <USelectMenu
                v-if="h2.categoryEnabled"
                v-model="h2.categoryLabel"
                :items="[
                  { label: '功能需求', value: 'functional' },
                  { label: '非功能需求', value: 'non_functional' }
                ]"
                value-key="value"
                class="w-36"
              />
            </div>
          </div>

          <div class="space-y-3">
            <div class="text-xs font-medium text-muted uppercase tracking-wide">
              步骤 2：在勾选的分类下标记需求与任务
            </div>
            <div
              v-for="h2 in h2Nodes.filter(n => n.categoryEnabled && n.categoryLabel)"
              :key="`cat-${h2.key}`"
              class="space-y-2"
            >
              <div class="text-sm font-semibold text-primary">
                [{{ h2.categoryLabel === 'functional' ? '功能需求' : '非功能需求' }}] {{ h2.title }}
              </div>
              <div v-if="h2.children.filter(c => c.depth === 3).length === 0" class="text-xs text-muted pl-4">
                该分类下无 H3 标题
              </div>
              <div
                v-for="h3 in h2.children.filter(c => c.depth === 3)"
                :key="h3.key"
                class="ml-4"
              >
                <DecomposeRequirementRow
                  :node="h3"
                  :default-deliverable-type="h2.categoryLabel === 'functional' ? 'code' : 'document'"
                  :expandable="true"
                  @toggle-pack="packSelected(h3)"
                  @unpack="(id) => unpack(h3, id)"
                  @child-change="(c) => onChildSelectChange(h3, c)"
                />
              </div>
            </div>
          </div>
        </div>

        <!-- 平铺模式：H2 为 target -->
        <div v-else class="space-y-3">
          <div
            v-for="h2 in h2Nodes"
            :key="h2.key"
          >
            <DecomposeRequirementRow
              :node="h2"
              :default-deliverable-type="'code'"
              :expandable="true"
              @toggle-pack="packSelected(h2)"
              @unpack="(id) => unpack(h2, id)"
              @child-change="(c) => onChildSelectChange(h2, c)"
            />
          </div>
        </div>
      </UCard>

      <!-- 右：任务分解预览 -->
      <UCard
        class="flex-1 min-w-0 flex flex-col"
        :ui="{ body: 'flex-1 min-h-0 overflow-y-auto' }"
      >
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-sparkles" class="size-4 text-primary" />
            <span class="font-semibold">分解预览</span>
            <span v-if="outline.length > 0" class="text-xs text-muted">
              · {{ summary.targetCount }} 个目标 / {{ summary.taskCount }} 个开发任务
            </span>
          </div>
        </template>

        <!-- 空态：还没勾选任何条目 -->
        <div v-if="summary.items.length === 0" class="h-full flex items-center justify-center text-sm text-muted p-6 text-center">
          <div>
            <UIcon name="i-lucide-arrow-left-circle" class="size-6 text-muted mx-auto mb-2" />
            从左侧勾选要分解的章节<br>
            右侧将实时预览将要创建的目标与开发任务
          </div>
        </div>

        <!-- 预览内容 -->
        <div v-else class="space-y-3">
          <div
            v-for="(item, idx) in summary.items"
            :key="`preview-${idx}`"
            class="rounded-lg border border-default bg-elevated/30 px-3 py-2.5 space-y-2"
          >
            <!-- 目标行 -->
            <div class="flex items-center gap-2 text-sm">
              <UIcon name="i-lucide-target" class="size-4 shrink-0 text-info" />
              <span class="font-medium truncate">
                {{ item.title }}
              </span>
              <UBadge
                v-if="item.category === 'functional'"
                color="info"
                variant="subtle"
                size="xs"
              >
                功能需求
              </UBadge>
              <UBadge
                v-else-if="item.category === 'non_functional'"
                color="warning"
                variant="subtle"
                size="xs"
              >
                非功能需求
              </UBadge>
              <!-- 优先级：行内可编辑 -->
              <USelectMenu
                v-model="item.targetNode.priority"
                :items="[
                  { label: 'P0', value: 'P0' },
                  { label: 'P1', value: 'P1' },
                  { label: 'P2', value: 'P2' },
                  { label: 'P3', value: 'P3' }
                ]"
                value-key="value"
                class="w-20"
                size="xs"
              />
              <div class="flex-1" />
              <span class="text-xs text-muted shrink-0">
                {{ item.kind === 'target_with_tasks' ? `1 目标 + ${item.tasks.length} 开发任务` : `1 目标 + 1 开发任务（直转）` }}
              </span>
            </div>

            <!-- 开发任务列表 -->
            <div class="pl-6 space-y-1">
              <div
                v-for="(task, tIdx) in item.tasks"
                :key="`preview-${idx}-${tIdx}`"
                class="flex items-center gap-2 text-sm"
              >
                <UIcon name="i-lucide-square-check-big" class="size-3 shrink-0 text-muted" />
                <span class="truncate flex-1">{{ task.title }}</span>
                <!-- 交付物类型：行内可编辑 -->
                <USelectMenu
                  v-model="task.nodes[0]!.deliverableType"
                  :items="[
                    { label: '代码', value: 'code' },
                    { label: '文档', value: 'document' },
                    { label: '制品', value: 'artifact' }
                  ]"
                  value-key="value"
                  class="w-24"
                  size="xs"
                />
                <span v-if="task.sourceAnchors.length > 1" class="text-xs text-info shrink-0">
                  合并 {{ task.sourceAnchors.length }} 项
                </span>
              </div>
            </div>
          </div>
        </div>
      </UCard>
    </div>

    <!-- 底部动作栏 -->
    <div class="shrink-0 flex items-center justify-between gap-3 border-t border-default bg-elevated/40 px-6 py-3">
      <div class="text-sm">
        <template v-if="outline.length > 0">
          预计创建
          <span class="font-semibold text-primary">{{ summary.targetCount }}</span>
          个目标 +
          <span class="font-semibold text-primary">{{ summary.taskCount }}</span>
          个开发任务
        </template>
        <template v-else>
          <span class="text-muted">请选择源文档并勾选要分解的章节</span>
        </template>
      </div>
      <div class="flex gap-2">
        <UButton color="neutral" variant="outline" @click="onCancel">
          取消
        </UButton>
        <UButton color="primary" :disabled="!canSubmit" @click="openSubmitDialog">
          提交分解结果
        </UButton>
      </div>
    </div>

    <!-- 源文档选择弹窗 -->
    <UModal v-model:open="showDocPickerModal" :ui="{ content: 'sm:max-w-5xl' }">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-folder-search" class="size-5 text-primary" />
          <h3 class="text-lg font-semibold">
            选择源文档
          </h3>
        </div>
      </template>
      <template #body>
        <div class="space-y-4 p-4">
          <UFormField
            label="项目组文档"
            :description="context && context.sourceProjectCodes.length > 0
              ? `已检索项目组：${context.sourceProjectCodes.join('、')}`
              : ''"
          >
            <USelectMenu
              v-model="docDraftUuid"
              :items="context?.sourceDocumentCandidates.map(d => ({
                label: `${d.title} · ${d.sourceProjectCode}`,
                value: d.codocsUuid
              })) || []"
              value-key="value"
              label-key="label"
              placeholder="请选择源文档"
              class="w-full"
              searchable
            />
          </UFormField>

          <div class="rounded-lg border border-default bg-elevated/40 p-4 min-h-48">
            <div v-if="!draftDoc" class="flex items-center justify-center py-10 text-sm text-muted">
              选择文档后将在这里显示预览
            </div>
            <div v-else class="h-[60vh]">
              <CodocsPreview
                :key="draftDoc.codocsUuid"
                :uuid="draftDoc.codocsUuid"
              />
            </div>
          </div>
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            label="取消"
            color="neutral"
            variant="ghost"
            @click="showDocPickerModal = false"
          />
          <UButton
            label="确定"
            color="primary"
            :disabled="!docDraftUuid"
            @click="confirmDocPick"
          />
        </div>
      </template>
    </UModal>

    <!-- 源文档预览弹窗（已选文档的只读预览） -->
    <UModal v-model:open="showDocPreviewModal" :ui="{ content: 'sm:max-w-5xl', body: 'overflow-hidden p-0' }">
      <template #header>
        <span class="text-base font-medium">{{ selectedDoc?.title || '文档预览' }}</span>
      </template>
      <template #body>
        <div class="h-[70vh] rounded-lg border border-default bg-elevated/40 p-4 min-h-48">
          <CodocsPreview
            v-if="selectedDoc && showDocPreviewModal"
            :key="selectedDoc.codocsUuid"
            :uuid="selectedDoc.codocsUuid"
          />
        </div>
      </template>
      <template #footer>
        <div class="flex justify-end">
          <UButton
            label="关闭"
            color="neutral"
            variant="soft"
            @click="showDocPreviewModal = false"
          />
        </div>
      </template>
    </UModal>

    <!-- 提交对话框 -->
    <UModal v-model:open="submitDialogOpen" :ui="{ content: 'w-[480px]' }">
      <template #content>
        <UCard>
          <template #header>
            <div class="font-semibold">
              提交需求分解
            </div>
          </template>
          <div class="space-y-4">
            <div class="text-sm text-muted">
              即将创建 <b>{{ summary.targetCount }}</b> 个目标和 <b>{{ summary.taskCount }}</b> 个开发任务。
              提交后将记录本次工时，并把源工作项提交至审批流程。
            </div>
            <UFormField
              label="本次投入工时（小时）"
              required
              class="w-full"
              orientation="horizontal"
            >
              <UInput
                v-model="submitForm.workHours"
                type="number"
                step="0.5"
                min="0"
                max="24"
                class="w-full"
              />
            </UFormField>
            <UFormField label="附言（可选）">
              <UTextarea
                v-model="submitForm.submitNote"
                :rows="2"
                class="w-full"
                placeholder="例如：完成首轮功能需求分解"
              />
            </UFormField>
          </div>
          <template #footer>
            <div class="flex justify-end gap-2">
              <UButton color="neutral" variant="outline" @click="submitDialogOpen = false">
                取消
              </UButton>
              <UButton color="primary" :loading="submitting" @click="doSubmit">
                确认提交
              </UButton>
            </div>
          </template>
        </UCard>
      </template>
    </UModal>
  </div>
</template>
