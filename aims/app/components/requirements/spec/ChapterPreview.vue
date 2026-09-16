<script setup lang="ts">
interface ContentNode {
  id: number
  title: string
  headingDepth: number
  status: string
  requirementId: number | null
  contentMd: string | null
  children: ContentNode[]
  parentId?: number | null
}

interface FlatContent {
  id: number
  parentId: number | null
  title: string
  contentMd?: string | null
  requirementId?: number | null
  status?: string
  children?: ContentNode[]
}

interface ReqBrief {
  id: number
  reqCode: string
  title: string
  status: string
}

const statusLabel: Record<string, string> = {
  draft: '草稿',
  in_review: '评审中',
  baselined: '已基线',
  change_pending: '变更中',
  deprecated: '已废弃'
}

const statusColor: Record<string, string> = {
  draft: 'neutral',
  in_review: 'warning',
  baselined: 'success',
  change_pending: 'info',
  deprecated: 'error'
}

const props = defineProps<{
  chapters: ContentNode[]
  allContents: FlatContent[]
  linkedRequirements: ReqBrief[]
  projectId: number
  canEditSpec: boolean
  canSetRequirement: boolean
  isPartial: boolean
  viewingReqId: number | null
  defaultMilestoneId?: number | null
  /** 当前选中的需求 target 工作项ID；创建/变更需求时挂接到该 target */
  activeTargetId?: number | null
}>()

const emit = defineEmits<{
  updated: [reason?: 'edit' | 'req' | 'structure']
}>()

const toast = useToast()

const reqMap = computed(() => {
  const map = new Map<number, ReqBrief>()
  for (const r of props.linkedRequirements) {
    map.set(r.id, r)
  }
  return map
})

// Multi-select: merged title
const isMulti = computed(() => props.chapters.length > 1)

// Strip leading numbering prefixes: "一、", "二、", "1.1 ", "2.3.1 ", "1 "
function stripPrefix(title: string): string {
  return title
    .replace(/^[一二三四五六七八九十百千零〇]+[、.]\s*/, '')
    .replace(/^\d+(\.\d+)*[、.\s]+\s*/, '')
    .trim()
}

function headingClassByDepth(depth: number): string {
  switch (depth) {
    case 1: return 'text-xl font-bold'
    case 2: return 'text-lg font-bold'
    case 3: return 'text-base font-semibold'
    case 4: return 'text-sm font-semibold'
    case 5: return 'text-xs font-semibold'
    default: return 'text-xs font-medium'
  }
}

function findContent(id: number): FlatContent | undefined {
  return props.allContents.find(c => c.id === id)
}

// Determine the parent module for the current selection
const parentModule = computed<FlatContent | null>(() => {
  if (props.chapters.length === 0) return null
  const first = props.chapters[0]!
  const firstFlat = findContent(first.id)

  // If first chapter is a module (no parent), return itself
  if (!firstFlat?.parentId) return firstFlat || null
  // Otherwise find the parent
  return findContent(firstFlat.parentId) || null
})

// Whether the whole module is selected as one integral requirement
const isIntegralModule = computed(() => {
  if (props.chapters.length === 0) return false
  const first = props.chapters[0]!
  const firstFlat = findContent(first.id)
  return !firstFlat?.parentId
})

// Excluded siblings: items not part of the current selection scope
// 仅对叶子节点（无子章节）做判断；带子节点的模块不算"未包含"
const excludedSiblings = computed<ContentNode[]>(() => {
  const mod = parentModule.value
  if (!mod || !mod.children) return []
  const leafChildren = mod.children.filter(c => !c.children || c.children.length === 0)

  if (isIntegralModule.value) {
    // Integral module mode: excluded = leaf children that already have their own requirement
    return leafChildren.filter(c => c.requirementId != null)
  }
  // Non-integral: leaf siblings NOT in current selection (regardless of requirement status)
  const selectedIds = new Set(props.chapters.map(c => c.id))
  return leafChildren.filter(s => !selectedIds.has(s.id))
})

// Whether the parent module already has any child as requirement (then module can't be set as req)
const moduleHasReqChildren = computed(() => {
  const mod = parentModule.value
  if (!mod || !mod.children) return false
  return mod.children.some(c => c.requirementId != null)
})

const scopeNote = computed(() => {
  if (excludedSiblings.value.length === 0) return ''
  const names = excludedSiblings.value.map(s => stripPrefix(s.title))
  return `注：${names.join('、')}等${excludedSiblings.value.length}项不包含在本需求范围中。`
})

// Whether "设为需求项" should be disabled (even if noneHasReq)
const cannotSetAsReq = computed(() => {
  // If we're in integral-module mode (single chapter is module), and module has req children → no
  return isIntegralModule.value && moduleHasReqChildren.value
})

const mergedTitle = computed(() => {
  if (props.chapters.length === 0) return ''

  const first = props.chapters[0]!
  const firstFlat = findContent(first.id)

  // Case 1: first chapter is a module (no parent) → module整体 mode
  if (!firstFlat?.parentId) {
    const moduleName = stripPrefix(first.title)
    const nonReqChildren = first.children.filter(c => c.requirementId == null)
    if (nonReqChildren.length === 0) return moduleName
    const firstChildName = stripPrefix(nonReqChildren[0]!.title)
    if (nonReqChildren.length === 1) return `${moduleName}--${firstChildName}`
    return `${moduleName}--${firstChildName}等${nonReqChildren.length}项`
  }

  // Case 2: leaf items — find parent module
  const parent = findContent(firstFlat.parentId)
  const moduleName = parent ? stripPrefix(parent.title) : ''
  const itemName = stripPrefix(first.title)

  if (props.chapters.length === 1) {
    return moduleName ? `${moduleName}--${itemName}` : itemName
  }
  return moduleName
    ? `${moduleName}--${itemName}等${props.chapters.length}项`
    : `${itemName}等${props.chapters.length}项`
})

// Check if all selected chapters already share the same requirement
const sharedReqId = computed(() => {
  if (props.chapters.length === 0) return null
  const first = props.chapters[0]!.requirementId
  if (!first) return null
  if (props.chapters.every(c => c.requirementId === first)) return first
  return null
})

const sharedReq = computed(() => {
  if (!sharedReqId.value) return null
  return reqMap.value.get(sharedReqId.value) || null
})
const displayedReq = computed(() => sharedReq.value || (props.viewingReqId ? reqMap.value.get(props.viewingReqId) || null : null))
const lockedRequirementStatuses = new Set(['in_review', 'baselined', 'change_pending'])

function isRequirementLocked(reqId: number | null | undefined): boolean {
  if (!reqId) return false
  const req = reqMap.value.get(reqId)
  return !!req && lockedRequirementStatuses.has(req.status)
}

function isChapterLocked(ch: ContentNode | FlatContent): boolean {
  if (isRequirementLocked(ch.requirementId)) return true
  return !!ch.children?.some(child => isChapterLocked(child))
}

function isChapterOrModuleLocked(ch: ContentNode | FlatContent): boolean {
  if (isChapterLocked(ch)) return true
  if (!ch.parentId) return false
  const parent = findContent(ch.parentId)
  return parent ? isChapterOrModuleLocked(parent) : false
}

const viewingReqLocked = computed(() => isRequirementLocked(props.viewingReqId))

// Any chapter has a requirement?
const anyHasReq = computed(() => props.chapters.some(c => c.requirementId != null))
// All chapters have no requirement?
const noneHasReq = computed(() => props.chapters.every(c => c.requirementId == null))
const singleSelectionTarget = computed<ContentNode | null>(() => props.chapters.length === 1 ? props.chapters[0]! : null)
const contentTargetLabel = computed(() => {
  const target = singleSelectionTarget.value
  if (!target) return '章节'
  return target.children.length > 0 ? '功能模块' : '功能项'
})

function hasAnyRequirement(node: ContentNode): boolean {
  if (node.requirementId != null) return true
  return node.children.some(child => hasAnyRequirement(child))
}

const canDeleteContentTarget = computed(() => {
  const target = singleSelectionTarget.value
  if (!props.canEditSpec || !target) return false
  if (target.status === 'deprecated') return false
  if (hasAnyRequirement(target)) return false
  return true
})

const canRestoreContentTarget = computed(() => {
  const target = singleSelectionTarget.value
  if (!props.canEditSpec || !target) return false
  return target.status === 'deprecated'
})

function getVisibleChildren(ch: ContentNode): ContentNode[] {
  if (!props.canSetRequirement) {
    return ch.children
  }
  return ch.children.filter(c => c.requirementId == null && c.status !== 'deprecated')
}

function collectRequirementContentIds(chapters: ContentNode[]): number[] {
  const ids: number[] = []
  const seen = new Set<number>()

  function walk(node: ContentNode) {
    const visibleChildren = getVisibleChildren(node)
    if (visibleChildren.length === 0) {
      if (!seen.has(node.id)) {
        seen.add(node.id)
        ids.push(node.id)
      }
      return
    }
    for (const child of visibleChildren) {
      walk(child)
    }
  }

  for (const chapter of chapters) {
    walk(chapter)
  }

  return ids
}

// Editing single chapter
const editingId = ref<number | null>(null)
const editTitle = ref('')
const editContent = ref('')
const saving = ref(false)

function startEdit(ch: ContentNode) {
  if (isChapterOrModuleLocked(ch)) return
  editingId.value = ch.id
  editTitle.value = ch.title
  editContent.value = ch.contentMd || ''
}

function startEditModule() {
  const mod = parentModule.value
  if (!mod || isChapterOrModuleLocked(mod)) return
  editingId.value = mod.id
  editTitle.value = mod.title
  editContent.value = mod.contentMd || ''
}

async function saveEdit(chId: number) {
  const target = findContent(chId)
  if (target && isChapterOrModuleLocked(target)) {
    editingId.value = null
    toast.add({ title: '需求已进入评审批次，对应章节内容不允许修改', color: 'warning' })
    return
  }
  saving.value = true
  try {
    await $fetch(`/api/v1/requirement-contents/${chId}`, {
      method: 'PATCH',
      body: { title: editTitle.value, contentMd: editContent.value }
    })
    toast.add({ title: '章节已更新', color: 'success' })
    editingId.value = null
    emit('updated', 'edit')
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message || '保存失败'
    toast.add({ title: msg, color: 'error' })
  } finally {
    saving.value = false
  }
}

// Set as requirement (single or multi)
const creatingReq = ref(false)
const showChangeModal = ref(false)
const changeReason = ref('')
const changeContents = ref<Array<{ contentId: number, title: string, contentMd: string, originalTitle: string, originalContentMd: string }>>([])
const creatingChange = ref(false)
const showUnsetModal = ref(false)
const unsettingRequirement = ref(false)
const pendingUnsetMode = ref<'shared' | 'viewing' | null>(null)
const showDeleteContentModal = ref(false)
const deletingContent = ref(false)
const showRestoreContentModal = ref(false)
const restoringContent = ref(false)

function collectChangeEditableContents(chapters: ContentNode[]) {
  const result: ContentNode[] = []
  const seen = new Set<number>()

  function push(node: ContentNode) {
    if (seen.has(node.id)) return
    seen.add(node.id)
    result.push(node)
  }

  function walk(node: ContentNode) {
    if (node.contentMd?.trim() || node.children.length === 0) {
      push(node)
    }
    for (const child of node.children) {
      walk(child)
    }
  }

  for (const chapter of chapters) {
    walk(chapter)
  }
  return result
}

function openChangeModal() {
  const req = displayedReq.value
  if (!req || req.status !== 'baselined') return
  changeReason.value = ''
  changeContents.value = collectChangeEditableContents(props.chapters).map(ch => ({
    contentId: ch.id,
    title: ch.title,
    contentMd: ch.contentMd || '',
    originalTitle: ch.title,
    originalContentMd: ch.contentMd || ''
  }))
  showChangeModal.value = true
}

async function createRequirementChange() {
  const req = displayedReq.value
  if (!req || req.status !== 'baselined') return
  creatingChange.value = true
  try {
    const res = await $fetch<{ code: number, data: { reqCode: string } }>(
      `/api/v1/requirements/${req.id}/changes`,
      {
        method: 'POST',
        body: {
          reason: changeReason.value,
          workItemId: props.activeTargetId ?? undefined,
          contents: changeContents.value.map(item => ({
            contentId: item.contentId,
            title: item.title,
            contentMd: item.contentMd
          }))
        }
      }
    )
    if (res.code === 0) {
      toast.add({ title: `已创建需求变更 ${res.data.reqCode}`, color: 'success' })
      showChangeModal.value = false
      emit('updated', 'req')
    }
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message || '创建需求变更失败'
    toast.add({ title: msg, color: 'error' })
  } finally {
    creatingChange.value = false
  }
}

async function setAsRequirement() {
  if (props.chapters.length === 0 || creatingReq.value) return
  creatingReq.value = true
  try {
    const title = mergedTitle.value
    const contentIds = collectRequirementContentIds(props.chapters)
    const res = await $fetch<{ code: number, data: { id: number, reqCode: string } }>(
      `/api/v1/projects/${props.projectId}/requirements`,
      {
        method: 'POST',
        timeout: 15000,
        body: {
          title,
          priority: 'P1',
          milestoneId: props.defaultMilestoneId ?? null,
          workItemId: props.activeTargetId ?? undefined,
          contentIds,
          scopeNote: scopeNote.value || undefined
        }
      }
    )
    if (res.code === 0) {
      toast.add({ title: `已创建需求项 ${res.data.reqCode}（关联 ${contentIds.length} 个章节）`, color: 'success' })
      emit('updated', 'req')
    }
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message || '创建需求项失败'
    toast.add({ title: msg, color: 'error' })
  } finally {
    creatingReq.value = false
  }
}

async function unsetRequirement() {
  const reqId = sharedReqId.value
  if (!reqId || isRequirementLocked(reqId)) return
  pendingUnsetMode.value = 'shared'
  showUnsetModal.value = true
}

async function unsetViewingReq() {
  if (!props.viewingReqId || viewingReqLocked.value) return
  pendingUnsetMode.value = 'viewing'
  showUnsetModal.value = true
}

async function confirmUnsetRequirement() {
  if (unsettingRequirement.value) return
  const reqId = pendingUnsetMode.value === 'shared'
    ? sharedReqId.value
    : props.viewingReqId
  if (!reqId) return

  unsettingRequirement.value = true
  try {
    await $fetch(`/api/v1/requirements/${reqId}`, { method: 'DELETE' })
    toast.add({ title: '已取消需求项', color: 'success' })
    showUnsetModal.value = false
    pendingUnsetMode.value = null
    emit('updated', 'req')
  } catch {
    toast.add({ title: '操作失败', color: 'error' })
  } finally {
    unsettingRequirement.value = false
  }
}

function requestDeleteContent() {
  if (!canDeleteContentTarget.value) return
  showDeleteContentModal.value = true
}

async function confirmDeleteContent() {
  const target = singleSelectionTarget.value
  if (!target || deletingContent.value) return

  deletingContent.value = true
  try {
    await $fetch(`/api/v1/requirement-contents/${target.id}`, { method: 'DELETE' })
    toast.add({ title: `${contentTargetLabel.value}已删除`, color: 'success' })
    showDeleteContentModal.value = false
    emit('updated', 'structure')
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message || '删除失败'
    toast.add({ title: msg, color: 'error' })
  } finally {
    deletingContent.value = false
  }
}

function requestRestoreContent() {
  if (!canRestoreContentTarget.value) return
  showRestoreContentModal.value = true
}

async function confirmRestoreContent() {
  const target = singleSelectionTarget.value
  if (!target || restoringContent.value) return

  restoringContent.value = true
  try {
    await $fetch(`/api/v1/requirement-contents/${target.id}/restore`, { method: 'POST' })
    toast.add({ title: `${contentTargetLabel.value}已恢复`, color: 'success' })
    showRestoreContentModal.value = false
    emit('updated', 'structure')
  } catch (err: unknown) {
    const msg = (err as { data?: { message?: string } })?.data?.message || '恢复失败'
    toast.add({ title: msg, color: 'error' })
  } finally {
    restoringContent.value = false
  }
}
</script>

<template>
  <div>
    <!-- Empty state -->
    <div
      v-if="chapters.length === 0"
      class="text-center text-muted py-16"
    >
      <UIcon
        name="i-lucide-mouse-pointer-click"
        class="size-8 mx-auto mb-2"
      />
      <p>点击或勾选左侧章节查看内容</p>
    </div>

    <template v-else>
      <!-- Merged header bar -->
      <div class="flex items-center justify-between gap-4 mb-4 pb-3 border-b border-default">
        <div>
          <h2 class="text-lg font-bold">
            {{ mergedTitle }}
          </h2>
          <div class="flex items-center gap-2 mt-1">
            <UBadge
              v-if="displayedReq"
              color="primary"
              variant="subtle"
              size="xs"
            >
              {{ displayedReq.reqCode }}
            </UBadge>
            <UBadge
              v-if="displayedReq"
              :color="(statusColor[displayedReq.status] as any)"
              variant="subtle"
              size="xs"
            >
              {{ statusLabel[displayedReq.status] || displayedReq.status }}
            </UBadge>
            <span
              v-if="isMulti"
              class="text-xs text-muted"
            >
              {{ chapters.length }} 个章节
            </span>
            <UBadge
              v-if="singleSelectionTarget?.status === 'deprecated'"
              color="error"
              variant="subtle"
              size="xs"
            >
              已删除
            </UBadge>
          </div>
        </div>
        <div class="flex items-center gap-1.5 shrink-0">
          <!-- Edit button: always targets the parent module (edits title + prefix content) -->
          <UButton
            v-if="parentModule && parentModule.status !== 'deprecated' && editingId !== parentModule.id && !isChapterOrModuleLocked(parentModule)"
            icon="i-lucide-pencil"
            label="编辑"
            color="neutral"
            variant="soft"
            size="xs"
            @click="startEditModule"
          />
          <UButton
            v-if="canDeleteContentTarget"
            icon="i-lucide-trash-2"
            :label="`删除${contentTargetLabel}`"
            color="error"
            variant="ghost"
            size="xs"
            @click="requestDeleteContent"
          />
          <UButton
            v-if="canRestoreContentTarget"
            icon="i-lucide-undo-2"
            :label="`恢复${contentTargetLabel}`"
            color="primary"
            variant="soft"
            size="xs"
            @click="requestRestoreContent"
          />
          <!-- Set as requirement: checkbox mode (multi) or click mode (single) -->
          <UButton
            v-if="props.canSetRequirement && noneHasReq && !props.viewingReqId && !cannotSetAsReq && chapters.every(ch => ch.status !== 'deprecated')"
            icon="i-lucide-tag"
            label="设为需求项"
            color="primary"
            variant="soft"
            size="xs"
            :loading="creatingReq"
            :disabled="creatingReq"
            @click="setAsRequirement"
          />
          <span
            v-else-if="cannotSetAsReq"
            class="text-xs text-muted"
          >
            模块已有需求项，请选择功能项设置
          </span>
          <UButton
            v-if="displayedReq?.status === 'baselined'"
            icon="i-lucide-file-pen-line"
            label="需求变更"
            color="warning"
            variant="soft"
            size="xs"
            @click="openChangeModal"
          />
          <!-- Unset requirement: checkbox mode -->
          <UButton
            v-if="sharedReq && props.canSetRequirement && !isRequirementLocked(sharedReq.id)"
            icon="i-lucide-tag-x"
            label="取消需求项"
            color="error"
            variant="ghost"
            size="xs"
            @click="unsetRequirement"
          />
          <!-- Unset requirement: click mode viewing a requirement -->
          <UButton
            v-if="props.viewingReqId && !props.canSetRequirement && !viewingReqLocked"
            icon="i-lucide-tag-x"
            label="取消需求项"
            color="error"
            variant="ghost"
            size="xs"
            @click="unsetViewingReq"
          />
          <!-- Mixed state hint -->
          <span
            v-if="anyHasReq && !sharedReq && !noneHasReq"
            class="text-xs text-warning"
          >
            部分章节已关联不同需求项
          </span>
        </div>
      </div>

      <!-- Unified module context (title + prefix content + exclusion note) -->
      <div
        v-if="parentModule"
        class="mb-4 pb-4 border-b border-default/50"
      >
        <!-- Module edit form (when editing the module) -->
        <div
          v-if="editingId === parentModule.id && !isChapterOrModuleLocked(parentModule)"
          class="space-y-3 background:secondary/10 p-4 border border-secondary-200 rounded-lg"
        >
          <UFormField label="模块标题">
            <UInput
              v-model="editTitle"
              class="w-full"
            />
          </UFormField>
          <UFormField label="章节前叙内容 (Markdown)">
            <UTextarea
              v-model="editContent"
              :rows="8"
              placeholder="此处可输入本模块的章节前置说明..."
              class="w-full font-mono text-sm"
            />
          </UFormField>
          <div class="flex gap-2 justify-end">
            <UButton
              label="保存"
              color="primary"
              size="sm"
              :loading="saving"
              @click="saveEdit(parentModule.id)"
            />
            <UButton
              label="取消"
              color="neutral"
              variant="ghost"
              size="sm"
              @click="editingId = null"
            />
          </div>
        </div>

        <template v-else>
          <!-- Module title -->
          <h3 class="text-base font-semibold mb-2">
            {{ stripPrefix(parentModule.title) }}
          </h3>

          <!-- Module prefix content -->
          <MarkdownContent
            v-if="parentModule.contentMd"
            :markdown="parentModule.contentMd"
            class="mb-2"
          />

          <!-- Exclusion note -->
          <div
            v-if="excludedSiblings.length > 0"
            class="text-xs text-warning bg-warning/10 rounded px-3 py-2 mt-2"
          >
            {{ scopeNote }}
          </div>
        </template>
      </div>

      <!-- Content display -->
      <template v-if="true">
        <div
          v-for="ch in chapters"
          :key="ch.id"
          class="mb-6 pb-6 border-b border-default/50 last:border-0"
        >
          <!-- Per-chapter sub-header (show for all leaf chapters; skip for integral module where ch === parentModule) -->
          <div
            v-if="ch.children.length === 0"
            class="flex items-center gap-2 mb-2"
          >
            <span :class="headingClassByDepth(ch.headingDepth)">{{ ch.title }}</span>
            <UBadge
              v-if="ch.status === 'modified'"
              color="warning"
              variant="subtle"
              size="xs"
            >
              已修改
            </UBadge>
            <UBadge
              v-if="ch.status === 'deprecated'"
              color="error"
              variant="subtle"
              size="xs"
            >
              已删除
            </UBadge>
            <!-- <span class="text-xs text-muted">H{{ ch.headingDepth }}</span> -->
            <div class="flex-1" />
            <UButton
              v-if="editingId !== ch.id && ch.status !== 'deprecated' && !isChapterOrModuleLocked(ch)"
              icon="i-lucide-pencil"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="startEdit(ch)"
            />
          </div>

          <!-- Case 1: Leaf node (no children) — show its contentMd directly -->
          <template v-if="ch.children.length === 0">
            <!-- Inline edit form -->
            <div
              v-if="editingId === ch.id && !isChapterOrModuleLocked(ch)"
              class="space-y-3 background:secondary/10 p-4 border border-secondary-200 rounded-lg"
            >
              <UFormField label="标题">
                <UInput
                  v-model="editTitle"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="正文 (Markdown)">
                <UTextarea
                  v-model="editContent"
                  :rows="8"
                  class="w-full font-mono text-sm"
                />
              </UFormField>
              <div class="flex gap-2 justify-end">
                <UButton
                  label="保存"
                  color="primary"
                  size="sm"
                  :loading="saving"
                  @click="saveEdit(ch.id)"
                />
                <UButton
                  label="取消"
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  @click="editingId = null"
                />
              </div>
            </div>
            <template v-else>
              <MarkdownContent
                v-if="ch.contentMd"
                :markdown="ch.contentMd"
              />
              <div
                v-else
                class="text-sm text-muted italic"
              >
                此章节暂无正文内容
              </div>
            </template>
          </template>

          <!-- Case 2: Has children — show children as sub-sections, skip parent contentMd -->
          <template v-else>
            <div class="space-y-4">
              <template
                v-for="child in getVisibleChildren(ch)"
                :key="child.id"
              >
                <div class="pl-4 border-l-2 border-default">
                  <div class="flex items-center gap-2 mb-1">
                    <span :class="headingClassByDepth(child.headingDepth)">{{ child.title }}</span>
                    <UBadge
                      v-if="child.requirementId && reqMap.get(child.requirementId)"
                      color="primary"
                      variant="subtle"
                      size="xs"
                    >
                      {{ reqMap.get(child.requirementId)!.reqCode }}
                    </UBadge>
                    <UBadge
                      v-if="child.status === 'deprecated'"
                      color="error"
                      variant="subtle"
                      size="xs"
                    >
                      已删除
                    </UBadge>
                    <!-- <span class="text-xs text-muted">H{{ child.headingDepth }}</span> -->
                    <div class="flex-1" />
                    <UButton
                      v-if="editingId !== child.id && child.status !== 'deprecated' && !isChapterOrModuleLocked(child)"
                      icon="i-lucide-pencil"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      @click="startEdit(child)"
                    />
                  </div>

                  <!-- Child edit mode -->
                  <div
                    v-if="editingId === child.id && !isChapterOrModuleLocked(child)"
                    class="space-y-3 background:secondary/10 p-4 border border-secondary-200 rounded-lg"
                  >
                    <UFormField label="标题">
                      <UInput v-model="editTitle" class="w-full" />
                    </UFormField>
                    <UFormField label="正文 (Markdown)">
                      <UTextarea v-model="editContent" :rows="8" class="w-full font-mono text-sm" />
                    </UFormField>
                    <div class="flex gap-2 justify-end">
                      <UButton
                        label="保存"
                        color="primary"
                        size="sm"
                        :loading="saving"
                        @click="saveEdit(child.id)"
                      />
                      <UButton
                        label="取消"
                        color="neutral"
                        variant="ghost"
                        size="sm"
                        @click="editingId = null"
                      />
                    </div>
                  </div>

                  <!-- Child content display -->
                  <template v-else>
                    <MarkdownContent
                      v-if="child.contentMd"
                      :markdown="child.contentMd"
                    />
                    <div
                      v-else
                      class="text-sm text-muted italic"
                    >
                      暂无内容
                    </div>
                  </template>
                </div>
              </template>
              <div
                v-if="getVisibleChildren(ch).length === 0"
                class="text-sm text-muted italic pl-4"
              >
                所有子章节均已设为需求项
              </div>
            </div>
          </template>
        </div>
      </template>
    </template>

    <UModal
      v-model:open="showDeleteContentModal"
      :title="`删除${contentTargetLabel}`"
      description="删除后仅做标记，不会物理删除记录。"
      :ui="{ content: 'sm:max-w-md' }"
    >
      <template #body>
        <div class="text-sm text-muted">
          确认删除当前{{ contentTargetLabel }}吗？后续可通过“显示已删除”后进行恢复。
        </div>
      </template>

      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            label="取消"
            color="neutral"
            variant="ghost"
            :disabled="deletingContent"
            @click="showDeleteContentModal = false"
          />
          <UButton
            label="确认删除"
            color="error"
            :loading="deletingContent"
            @click="confirmDeleteContent"
          />
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="showRestoreContentModal"
      :title="`恢复${contentTargetLabel}`"
      description="恢复后该节点会重新显示在规格书中。"
      :ui="{ content: 'sm:max-w-md' }"
    >
      <template #body>
        <div class="text-sm text-muted">
          确认恢复当前{{ contentTargetLabel }}吗？
        </div>
      </template>

      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            label="取消"
            color="neutral"
            variant="ghost"
            :disabled="restoringContent"
            @click="showRestoreContentModal = false"
          />
          <UButton
            label="确认恢复"
            color="primary"
            :loading="restoringContent"
            @click="confirmRestoreContent"
          />
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="showUnsetModal"
      title="取消需求项"
      description="取消后会删除对应需求项。"
      :ui="{ content: 'sm:max-w-md' }"
    >
      <template #body>
        <div class="text-sm text-muted">
          确认要取消当前需求项关联吗？
        </div>
      </template>

      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            label="继续保留"
            color="neutral"
            variant="ghost"
            :disabled="unsettingRequirement"
            @click="showUnsetModal = false"
          />
          <UButton
            label="确认取消"
            color="error"
            :loading="unsettingRequirement"
            @click="confirmUnsetRequirement"
          />
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="showChangeModal"
      title="创建需求变更"
      description="基于当前已生效版本创建变更草稿，提交评审通过后合入基线。"
      :ui="{ content: 'sm:max-w-5xl' }"
    >
      <template #body>
        <div class="space-y-4">
          <div
            v-if="displayedReq"
            class="flex items-center gap-2 text-sm"
          >
            <UBadge color="primary" variant="subtle">
              {{ displayedReq.reqCode }}
            </UBadge>
            <span class="font-medium">{{ displayedReq.title }}</span>
          </div>

          <UFormField label="变更原因">
            <UTextarea
              v-model="changeReason"
              :rows="3"
              class="w-full"
              placeholder="说明本次需求变更的原因"
            />
          </UFormField>

          <div class="space-y-5">
            <div
              v-for="item in changeContents"
              :key="item.contentId"
              class="rounded-lg border border-default p-4 space-y-3"
            >
              <UFormField label="章节标题">
                <UInput v-model="item.title" class="w-full" />
              </UFormField>
              <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <UFormField label="当前生效内容">
                  <UTextarea
                    :model-value="item.originalContentMd"
                    :rows="12"
                    variant="subtle"
                    color="neutral"
                    readonly
                    class="w-full font-mono text-sm"
                  />
                </UFormField>
                <UFormField label="变更后内容">
                  <UTextarea
                    v-model="item.contentMd"
                    :rows="12"
                    class="w-full bg-muted/10 font-mono text-sm"
                  />
                </UFormField>
              </div>
            </div>
          </div>
        </div>
      </template>

      <template #footer>
        <div class="flex justify-end gap-2 w-full">
          <UButton
            label="取消"
            color="neutral"
            variant="ghost"
            @click="showChangeModal = false"
          />
          <UButton
            label="保存变更草稿"
            color="warning"
            :loading="creatingChange"
            @click="createRequirementChange"
          />
        </div>
      </template>
    </UModal>
  </div>
</template>

<style scoped>
/* .chapter-md-content 样式已迁移到 app/assets/css/main.css (全局) */
</style>
