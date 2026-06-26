<script setup lang="ts">
import type { Project } from '~/types/account'

definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '项目产出',
  layoutHeaderProjectSwitcher: true
})

const route = useRoute()
const projectId = computed(() => Number(route.params.id))
const projectStore = useProjectStore()
// const { isApprovalMode } = useApprovalMode()

// ========================
// 初始化
// ========================
// ========================
// 交付物
// ========================
interface DeliverableItem {
  id: number
  entityType: string
  entityId: number | null
  targetId: number | null
  matterId: number | null
  name: string
  acceptanceCriteria: string | null
  deliverableType: string
  required: boolean
  status: string
  documentUuid: string | null
  documentTitle: string | null
  documentSource: 'codocs' | 'repo'
  repoProjectCode: string | null
  repoFilePath: string | null
  repoCommitId: string | null
  targetItemKey: string | null
  targetTitle: string | null
  matterItemKey: string | null
  matterTitle: string | null
  evidenceUrl: string | null
}

type RawDeliverableItem = Partial<DeliverableItem> & {
  entity_type?: string
  entity_id?: number | null
  target_id?: number | null
  matter_id?: number | null
  acceptance_criteria?: string | null
  deliverable_type?: string
  document_uuid?: string | null
  document_title?: string | null
  document_source?: 'codocs' | 'repo'
  repo_project_code?: string | null
  repo_file_path?: string | null
  repo_commit_id?: string | null
  target_item_key?: string | null
  target_title?: string | null
  matter_item_key?: string | null
  matter_title?: string | null
  evidence_url?: string | null
}

interface DeliveryDocumentRow {
  id: number
  deliverableName: string
  source: string
  requirement: string
  required: boolean
  status: string
  submittedDocumentName: string
  previewable: boolean
  original: DeliverableItem
}

type ListPayload<T> = T[] | {
  items?: T[]
}

function normalizeListPayload<T>(data: ListPayload<T> | null | undefined) {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.items)) return data.items
  return []
}

function normalizeDeliverable(raw: RawDeliverableItem): DeliverableItem {
  return {
    id: Number(raw.id),
    entityType: raw.entityType ?? raw.entity_type ?? '',
    entityId: raw.entityId ?? raw.entity_id ?? null,
    targetId: raw.targetId ?? raw.target_id ?? null,
    matterId: raw.matterId ?? raw.matter_id ?? null,
    name: raw.name ?? '',
    acceptanceCriteria: raw.acceptanceCriteria ?? raw.acceptance_criteria ?? null,
    deliverableType: raw.deliverableType ?? raw.deliverable_type ?? '',
    required: Boolean(raw.required),
    status: raw.status ?? 'pending',
    documentUuid: raw.documentUuid ?? raw.document_uuid ?? null,
    documentTitle: raw.documentTitle ?? raw.document_title ?? null,
    documentSource: raw.documentSource ?? raw.document_source ?? 'codocs',
    repoProjectCode: raw.repoProjectCode ?? raw.repo_project_code ?? null,
    repoFilePath: raw.repoFilePath ?? raw.repo_file_path ?? null,
    repoCommitId: raw.repoCommitId ?? raw.repo_commit_id ?? null,
    targetItemKey: raw.targetItemKey ?? raw.target_item_key ?? null,
    targetTitle: raw.targetTitle ?? raw.target_title ?? null,
    matterItemKey: raw.matterItemKey ?? raw.matter_item_key ?? null,
    matterTitle: raw.matterTitle ?? raw.matter_title ?? null,
    evidenceUrl: raw.evidenceUrl ?? raw.evidence_url ?? null
  }
}

const deliverables = ref<DeliverableItem[]>([])
const deliverablesLoading = ref(false)

async function loadDeliverables() {
  deliverablesLoading.value = true
  try {
    const res = await $fetch<{ code: number, data: ListPayload<RawDeliverableItem> }>(
      '/api/v1/deliverables',
      { params: { project_id: projectId.value } }
    )
    if (res.code === 0) {
      deliverables.value = normalizeListPayload(res.data).map(normalizeDeliverable)
    }
  } catch (err) {
    console.error('[Output] Failed to load deliverables:', err)
  } finally {
    deliverablesLoading.value = false
  }
}

function getDisplayDeliverableStatus(deliverable: DeliverableItem) {
  if (
    deliverable.deliverableType === 'document'
    && deliverable.status === 'pending'
    && canPreviewDeliverableDocument(deliverable)
  ) {
    return 'submitted'
  }
  return deliverable.status
}

const deliverableStats = computed(() => {
  const total = documentDeliverables.value.length
  const approved = documentDeliverables.value.filter(d => getDisplayDeliverableStatus(d) === 'approved').length
  const submitted = documentDeliverables.value.filter(d => getDisplayDeliverableStatus(d) === 'submitted').length
  const pending = documentDeliverables.value.filter(d => getDisplayDeliverableStatus(d) === 'pending').length
  return { total, approved, submitted, pending }
})

const deliverableStatusConfig: Record<string, { label: string, color: string }> = {
  pending: { label: '待提交', color: 'neutral' },
  submitted: { label: '已提交', color: 'info' },
  approved: { label: '已通过', color: 'success' },
  rejected: { label: '已驳回', color: 'error' }
}

const documentDeliverables = computed(() =>
  deliverables.value.filter(d => d.deliverableType === 'document')
)

function getDeliverableSourceLabel(deliverable: DeliverableItem) {
  if (deliverable.targetItemKey || deliverable.targetTitle) {
    return [deliverable.targetItemKey, deliverable.targetTitle].filter(Boolean).join(' · ')
  }
  return '未关联目标'
}

function getDeliverableDocumentLabel(deliverable: DeliverableItem) {
  return deliverable.documentTitle || deliverable.repoFilePath || deliverable.documentUuid || deliverable.name
}

function getDeliverableRequirementLabel(deliverable: DeliverableItem) {
  return deliverable.acceptanceCriteria || '-'
}

function canPreviewDeliverableDocument(deliverable: DeliverableItem) {
  if (deliverable.deliverableType !== 'document') return false
  if (deliverable.documentSource === 'repo') {
    return Boolean(deliverable.repoProjectCode && deliverable.repoFilePath)
  }
  return Boolean(deliverable.documentUuid)
}

const documentColumns = [
  // { accessorKey: 'required', header: '' },
  { accessorKey: 'deliverableName', header: '文档名称' },
  { accessorKey: 'source', header: '来源' },
  { accessorKey: 'requirement', header: '要求' },
  // { accessorKey: 'status', header: '状态' },
  { accessorKey: 'submittedDocumentName', header: '文档' }
]

const naturalSortCollator = new Intl.Collator('zh-Hans-CN', {
  numeric: true,
  sensitivity: 'base'
})

const documentRows = computed<DeliveryDocumentRow[]>(() =>
  [...documentDeliverables.value]
    .sort((a, b) => {
      const sourceCompare = naturalSortCollator.compare(
        a.targetItemKey || getDeliverableSourceLabel(a),
        b.targetItemKey || getDeliverableSourceLabel(b)
      )
      if (sourceCompare !== 0) return sourceCompare
      const titleCompare = naturalSortCollator.compare(a.targetTitle || '', b.targetTitle || '')
      if (titleCompare !== 0) return titleCompare
      return naturalSortCollator.compare(a.name, b.name)
    })
    .map(deliverable => ({
      id: deliverable.id,
      deliverableName: deliverable.name,
      source: getDeliverableSourceLabel(deliverable),
      requirement: getDeliverableRequirementLabel(deliverable),
      required: deliverable.required,
      status: getDisplayDeliverableStatus(deliverable),
      submittedDocumentName: canPreviewDeliverableDocument(deliverable)
        ? getDeliverableDocumentLabel(deliverable)
        : '未提交',
      previewable: canPreviewDeliverableDocument(deliverable),
      original: deliverable
    }))
)

onMounted(async () => {
  if (!projectStore.currentProject || projectStore.currentProject.id !== projectId.value) {
    await projectStore.fetchProject(projectId.value)
  }
  await Promise.all([
    projectStore.fetchRepos(projectId.value),
    loadDeliverables(),
    loadProjectDocs()
  ])
})

const repos = computed(() => projectStore.currentProject?.repos || [])
const alreadyLinkedCodes = computed(() => new Set(repos.value.map(r => r.repoProjectCode)))

// ========================
// 关联仓库弹窗
// ========================
const showAddRepoModal = ref(false)
const addingRepo = ref(false)

// 从 Account 加载部门仓库树
const accountRepos = ref<Project[]>([])
const accountReposLoading = ref(false)

// 选中的仓库编码（用 Record 保证响应性，Set 的 add/delete 在 Vue 中不可靠触发更新）
const selectedRepoCodes = ref<Record<string, boolean>>({})

function isSelected(code: string) {
  return !!selectedRepoCodes.value[code]
}

// ========================
// 树节点操作
// ========================
const expandedGroups = ref<Set<string>>(new Set())

function toggleGroup(code: string) {
  if (expandedGroups.value.has(code)) {
    expandedGroups.value.delete(code)
  } else {
    expandedGroups.value.add(code)
  }
}

// 获取节点下所有叶子节点的 projectCode
function getLeafCodes(node: Project): string[] {
  if (!node.subProjects || node.subProjects.length === 0) {
    return node.isGroup ? [] : [node.projectCode]
  }
  return node.subProjects.flatMap(getLeafCodes)
}

// 判断节点是否全选
function isGroupAllSelected(node: Project): boolean {
  const leaves = getLeafCodes(node)
  if (leaves.length === 0) return false
  return leaves.every(code => isSelected(code) || alreadyLinkedCodes.value.has(code))
}

// 判断节点是否部分选中
function isGroupPartialSelected(node: Project): boolean {
  const leaves = getLeafCodes(node)
  if (leaves.length === 0) return false
  const selectedCount = leaves.filter(code => isSelected(code) || alreadyLinkedCodes.value.has(code)).length
  return selectedCount > 0 && selectedCount < leaves.length
}

// 切换单个叶子节点
function toggleLeaf(code: string) {
  if (alreadyLinkedCodes.value.has(code)) return
  const current = { ...selectedRepoCodes.value }
  if (current[code]) {
    Reflect.deleteProperty(current, code)
  } else {
    current[code] = true
  }
  selectedRepoCodes.value = current
}

// 切换组节点（选中/取消所有叶子）
function toggleGroupSelect(node: Project) {
  const leaves = getLeafCodes(node).filter(code => !alreadyLinkedCodes.value.has(code))
  const allSelected = leaves.every(code => isSelected(code))
  const current = { ...selectedRepoCodes.value }
  if (allSelected) {
    leaves.forEach(code => Reflect.deleteProperty(current, code))
  } else {
    leaves.forEach((code) => {
      current[code] = true
    })
  }
  selectedRepoCodes.value = current
}

// 新增选中数量
const newSelectedCount = computed(() => Object.keys(selectedRepoCodes.value).length)

// ========================
// 批量关联
// ========================
async function handleBatchLink() {
  const codes = Object.keys(selectedRepoCodes.value)
  if (codes.length === 0) return
  addingRepo.value = true
  try {
    for (const code of codes) {
      await projectStore.linkRepo(projectId.value, code)
    }
    showAddRepoModal.value = false
    await projectStore.fetchRepos(projectId.value)
  } catch (err: unknown) {
    console.error('[Output] Failed to link repos:', err)
    const e = err as { data?: { message?: string }, message?: string }
    alert(e.data?.message || e.message || '关联失败')
  } finally {
    addingRepo.value = false
  }
}

// ========================
// 移除关联
// ========================
async function handleRemoveRepo(repoProjectCode: string) {
  if (!confirm(`确定解除仓库 ${repoProjectCode} 的关联吗？`)) return
  await projectStore.unlinkRepo(projectId.value, repoProjectCode)
}

// ========================
// 项目立项书 & 需求规格书
// ========================
interface ProjectDocSummary {
  id: number
  uuid: string
  title: string
  docCategory: string | null
  codocsUuid: string | null
  createdAt: string
}

type RawProjectDocSummary = Partial<ProjectDocSummary> & {
  doc_category?: string | null
  codocs_uuid?: string | null
  created_at?: string
}

function normalizeProjectDoc(raw: RawProjectDocSummary): ProjectDocSummary {
  return {
    id: Number(raw.id),
    uuid: raw.uuid ?? '',
    title: raw.title ?? '',
    docCategory: raw.docCategory ?? raw.doc_category ?? null,
    codocsUuid: raw.codocsUuid ?? raw.codocs_uuid ?? null,
    createdAt: raw.createdAt ?? raw.created_at ?? ''
  }
}

const proposalDoc = ref<ProjectDocSummary | null>(null)
const requirementSpecDoc = ref<ProjectDocSummary | null>(null)

async function loadProjectDocs() {
  try {
    const res = await $fetch<{ code: number, data: ListPayload<RawProjectDocSummary> | { documents?: RawProjectDocSummary[] } }>(
      `/api/v1/projects/${projectId.value}/documents`
    )
    if (res.code === 0) {
      const docs = ('documents' in res.data && Array.isArray(res.data.documents)
        ? res.data.documents
        : normalizeListPayload(res.data as ListPayload<RawProjectDocSummary>)
      ).map(normalizeProjectDoc)
      proposalDoc.value = docs.find(d => d.docCategory === 'project_proposal') || null
      requirementSpecDoc.value = docs.find(d => d.docCategory === 'requirement_spec') || null
    }
  } catch (err) {
    console.error('[Output] Failed to load project docs:', err)
  }
}

// 预览弹窗
const showDocPreview = ref(false)
const previewDocTitle = ref('')
const previewDocRef = ref<{
  source: 'codocs' | 'repo'
  title: string
  codocsUuid?: string | null
  repoProjectCode?: string | null
  repoFilePath?: string | null
  repoCommitId?: string | null
} | null>(null)

function openProjectDocPreview(doc: ProjectDocSummary | null) {
  if (!doc || !doc.codocsUuid) return
  previewDocTitle.value = doc.title
  previewDocRef.value = {
    source: 'codocs',
    title: doc.title,
    codocsUuid: doc.codocsUuid
  }
  showDocPreview.value = true
}

function openDeliverableDocPreview(deliverable: DeliverableItem) {
  if (!canPreviewDeliverableDocument(deliverable)) return

  const title = getDeliverableDocumentLabel(deliverable)
  previewDocTitle.value = title
  previewDocRef.value = deliverable.documentSource === 'repo'
    ? {
        source: 'repo',
        title,
        repoProjectCode: deliverable.repoProjectCode,
        repoFilePath: deliverable.repoFilePath,
        repoCommitId: deliverable.repoCommitId
      }
    : {
        source: 'codocs',
        title,
        codocsUuid: deliverable.documentUuid
      }
  showDocPreview.value = true
}
</script>

<template>
  <UDashboardPanel id="project-output" :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }">
    <template #body>
      <div class="flex flex-col h-full min-h-0">
        <ProjectNavbar />
        <div class="flex-1 min-h-0 overflow-y-auto px-4 pt-4 pb-12 space-y-6">
          <!-- 项目立项书 / 需求规格书 -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- 项目立项书 -->
            <UCard>
              <template #header>
                <div class="flex items-center gap-2">
                  <UIcon name="i-lucide-file-signature" class="size-5 text-primary" />
                  <span class="font-semibold">项目立项书</span>
                </div>
              </template>
              <button
                v-if="proposalDoc"
                type="button"
                class="w-full flex items-center gap-3 px-3 py-2.5 rounded-md bg-elevated hover:bg-elevated/80 transition-colors text-left cursor-pointer"
                @click="openProjectDocPreview(proposalDoc)"
              >
                <UIcon name="i-lucide-file-text" class="size-5 text-primary shrink-0" />
                <div class="min-w-0 flex-1">
                  <div class="text-sm font-medium truncate">
                    {{ proposalDoc.title }}
                  </div>
                </div>
                <div class="text-xs text-muted shrink-0">
                  点击预览
                </div>
              </button>
              <div v-else class="flex items-center gap-2 px-3 py-4 rounded-md bg-elevated/40 text-sm text-muted">
                <UIcon name="i-lucide-file-x" class="size-4" />
                尚未上传项目立项书
              </div>
            </UCard>

            <!-- 需求规格书 -->
            <UCard>
              <template #header>
                <div class="flex items-center gap-2">
                  <UIcon name="i-lucide-book-marked" class="size-5 text-info" />
                  <span class="font-semibold">需求规格书</span>
                </div>
              </template>
              <button
                v-if="requirementSpecDoc"
                type="button"
                class="w-full flex items-center gap-3 px-3 py-2.5 rounded-md bg-elevated hover:bg-elevated/80 transition-colors text-left cursor-pointer"
                @click="openProjectDocPreview(requirementSpecDoc)"
              >
                <UIcon name="i-lucide-file-text" class="size-5 text-info shrink-0" />
                <div class="min-w-0 flex-1">
                  <div class="text-sm font-medium truncate">
                    {{ requirementSpecDoc.title }}
                  </div>
                </div>
                <div class="text-xs text-muted shrink-0">
                  点击预览
                </div>
              </button>
              <div v-else class="flex items-center gap-2 px-3 py-4 rounded-md bg-elevated/40 text-sm text-muted">
                <UIcon name="i-lucide-file-x" class="size-4" />
                尚未上传需求规格书
              </div>
            </UCard>
          </div>

          <!-- 交付文档 -->
          <UCard>
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-files" class="w-4 h-4 text-primary" />
                <span class="font-semibold">交付文档</span>
                <template v-if="deliverableStats.total > 0">
                  <UBadge color="success" variant="subtle" size="xs">
                    通过 {{ deliverableStats.approved }}
                  </UBadge>
                  <UBadge
                    v-if="deliverableStats.submitted > 0"
                    color="info"
                    variant="subtle"
                    size="xs"
                  >
                    待审 {{ deliverableStats.submitted }}
                  </UBadge>
                  <UBadge
                    v-if="deliverableStats.pending > 0"
                    color="neutral"
                    variant="subtle"
                    size="xs"
                  >
                    待提交 {{ deliverableStats.pending }}
                  </UBadge>
                  <span class="text-xs text-muted">
                    {{ deliverableStats.approved }}/{{ deliverableStats.total }}
                  </span>
                </template>
              </div>
            </template>

            <div v-if="deliverablesLoading" class="flex justify-center py-6">
              <UIcon name="i-lucide-loader-2" class="w-5 h-5 animate-spin text-muted" />
            </div>

            <div v-else-if="documentRows.length === 0" class="text-center py-6 text-sm text-muted">
              暂无交付文档
            </div>

            <div v-else class="overflow-hidden ">
              <UTable
                :data="documentRows"
                :columns="documentColumns"
                class="w-full"
              >
                <template #deliverableName-cell="{ row }">
                  <div class="min-w-0 py-1">
                    <UBadge :color="row.original.required ? 'warning' : 'neutral'" variant="subtle" size="xs">
                      {{ row.original.required ? '必需' : '可选' }}
                    </UBadge>
                    <span class="font-medium text-highlighted wrap-break-words">
                      {{ row.original.deliverableName }}
                    </span>
                  </div>
                </template>
                <template #source-cell="{ row }">
                  <div class="min-w-0 py-1">
                    <span class="text-sm wrap-break-words">{{ row.original.source }}</span>
                  </div>
                </template>
                <template #requirement-cell="{ row }">
                  <div class="py-1 text-sm text-muted wrap-break-words">
                    {{ row.original.requirement }}
                  </div>
                </template>

                <template #status-cell="{ row }">
                  <UBadge
                    :color="(deliverableStatusConfig[row.original.status]?.color as any) || 'neutral'"
                    variant="subtle"
                    size="sm"
                  >
                    {{ deliverableStatusConfig[row.original.status]?.label || row.original.status }}
                  </UBadge>
                </template>
                <template #submittedDocumentName-cell="{ row }">
                  <button
                    v-if="row.original.previewable"
                    type="button"
                    class="max-w-xs truncate text-left text-primary hover:underline"
                    @click="openDeliverableDocPreview(row.original.original)"
                  >
                    {{ row.original.submittedDocumentName }}
                  </button>
                  <span v-else class="text-sm text-muted">
                    未提交
                  </span>
                </template>
              </UTable>
            </div>
          </UCard>

          <!-- 关联仓库 -->
          <UCard>
            <template #header>
              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <UIcon name="i-lucide-git-branch" class="w-4 h-4 text-success" />
                  <span class="font-semibold">代码仓库</span>
                  <UBadge
                    v-if="repos.length > 0"
                    color="neutral"
                    variant="subtle"
                    size="xs"
                  >
                    {{ repos.length }}
                  </UBadge>
                </div>
                <!-- <UButton
                  v-if="!isApprovalMode"
                  icon="i-lucide-plus"
                  label="关联仓库"
                  color="primary"
                  variant="soft"
                  size="sm"
                  @click="openAddRepoModal"
                /> -->
              </div>
            </template>
            <div v-if="repos.length === 0" class="text-center py-6 text-sm text-muted">
              暂未关联任何仓库
            </div>
            <div v-else class="space-y-2">
              <div
                v-for="repo in repos"
                :key="repo.id"
                class="flex items-center justify-between px-3 py-2 rounded-md bg-elevated"
              >
                <div>
                  <div class="font-medium text-sm font-mono">
                    {{ repo.repoProjectCode }}
                  </div>
                  <!-- <div class="text-xs text-muted">
                    最后同步: {{ repo.lastSyncedAt ? formatDate(repo.lastSyncedAt) : '从未同步' }}
                  </div> -->
                </div>
                <UButton
                  icon="i-lucide-unlink"
                  color="error"
                  variant="ghost"
                  size="xs"
                  @click="handleRemoveRepo(repo.repoProjectCode)"
                />
              </div>
            </div>
          </UCard>

          <!-- 关联仓库弹窗 - 树形多选 -->
          <UModal v-model:open="showAddRepoModal" :ui="{ content: 'sm:max-w-2xl' }">
            <template #header>
              <div class="flex items-center justify-between w-full">
                <h3 class="text-lg font-semibold">
                  关联仓库
                </h3>
                <span v-if="newSelectedCount > 0" class="text-sm text-primary">
                  已选 {{ newSelectedCount }} 个
                </span>
              </div>
            </template>
            <template #body>
              <div class="p-4">
                <p class="text-sm text-muted mb-3">
                  选择本部门的 GitLab 仓库关联到当前项目，选中组则自动选中其下所有仓库。
                </p>

                <!-- 加载中 -->
                <div v-if="accountReposLoading" class="flex justify-center py-8">
                  <UIcon name="i-lucide-loader-2" class="w-6 h-6 animate-spin text-muted" />
                </div>

                <!-- 空状态 -->
                <div v-else-if="accountRepos.length === 0" class="text-center py-8 text-sm text-muted">
                  本部门暂无 GitLab 仓库
                </div>

                <!-- 仓库树 -->
                <div v-else class="max-h-96 overflow-y-auto space-y-0.5">
                  <template v-for="node in accountRepos" :key="node.projectCode">
                    <!-- 组节点 -->
                    <div v-if="node.isGroup || (node.subProjects && node.subProjects.length > 0)">
                      <div class="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-elevated cursor-pointer select-none">
                        <button
                          class="shrink-0"
                          @click="toggleGroup(node.projectCode)"
                        >
                          <UIcon
                            :name="expandedGroups.has(node.projectCode) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                            class="w-4 h-4 text-muted"
                          />
                        </button>
                        <label class="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                          <input
                            type="checkbox"
                            class="rounded border-default text-primary focus:ring-primary"
                            :checked="isGroupAllSelected(node)"
                            :indeterminate="isGroupPartialSelected(node) && !isGroupAllSelected(node)"
                            @change="toggleGroupSelect(node)"
                          >
                          <UIcon name="i-lucide-folder" class="w-4 h-4 text-warning shrink-0" />
                          <span class="text-sm font-medium truncate">{{ node.name }}</span>
                          <span class="text-xs text-muted ml-1">({{ getLeafCodes(node).length }})</span>
                        </label>
                      </div>

                      <!-- 子节点 -->
                      <div v-if="expandedGroups.has(node.projectCode)" class="pl-6 space-y-0.5">
                        <template v-for="child in node.subProjects" :key="child.projectCode">
                          <!-- 子组 -->
                          <div v-if="child.isGroup || (child.subProjects && child.subProjects.length > 0)">
                            <div class="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-elevated cursor-pointer select-none">
                              <button
                                class="shrink-0"
                                @click="toggleGroup(child.projectCode)"
                              >
                                <UIcon
                                  :name="expandedGroups.has(child.projectCode) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                                  class="w-4 h-4 text-muted"
                                />
                              </button>
                              <label class="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                                <input
                                  type="checkbox"
                                  class="rounded border-default text-primary focus:ring-primary"
                                  :checked="isGroupAllSelected(child)"
                                  :indeterminate="isGroupPartialSelected(child) && !isGroupAllSelected(child)"
                                  @change="toggleGroupSelect(child)"
                                >
                                <UIcon name="i-lucide-folder" class="w-4 h-4 text-warning shrink-0" />
                                <span class="text-sm truncate">{{ child.name }}</span>
                                <span class="text-xs text-muted ml-1">({{ getLeafCodes(child).length }})</span>
                              </label>
                            </div>
                            <div v-if="expandedGroups.has(child.projectCode)" class="pl-6 space-y-0.5">
                              <div
                                v-for="leaf in child.subProjects"
                                :key="leaf.projectCode"
                                class="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-elevated select-none"
                                :class="alreadyLinkedCodes.has(leaf.projectCode) ? 'opacity-50' : 'cursor-pointer'"
                              >
                                <div class="w-4 shrink-0" />
                                <label class="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    class="rounded border-default text-primary focus:ring-primary"
                                    :checked="isSelected(leaf.projectCode) || alreadyLinkedCodes.has(leaf.projectCode)"
                                    :disabled="alreadyLinkedCodes.has(leaf.projectCode)"
                                    @change="toggleLeaf(leaf.projectCode)"
                                  >
                                  <UIcon name="i-lucide-git-branch" class="w-4 h-4 text-success shrink-0" />
                                  <span class="text-sm truncate">{{ leaf.name }}</span>
                                  <UBadge
                                    v-if="alreadyLinkedCodes.has(leaf.projectCode)"
                                    color="neutral"
                                    variant="subtle"
                                    size="xs"
                                  >
                                    已关联
                                  </UBadge>
                                </label>
                              </div>
                            </div>
                          </div>
                          <!-- 叶子节点 -->
                          <div
                            v-else
                            class="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-elevated select-none"
                            :class="alreadyLinkedCodes.has(child.projectCode) ? 'opacity-50' : 'cursor-pointer'"
                          >
                            <div class="w-4 shrink-0" />
                            <label class="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                              <input
                                type="checkbox"
                                class="rounded border-default text-primary focus:ring-primary"
                                :checked="isSelected(child.projectCode) || alreadyLinkedCodes.has(child.projectCode)"
                                :disabled="alreadyLinkedCodes.has(child.projectCode)"
                                @change="toggleLeaf(child.projectCode)"
                              >
                              <UIcon name="i-lucide-git-branch" class="w-4 h-4 text-success shrink-0" />
                              <span class="text-sm truncate">{{ child.name }}</span>
                              <UBadge
                                v-if="alreadyLinkedCodes.has(child.projectCode)"
                                color="neutral"
                                variant="subtle"
                                size="xs"
                              >
                                已关联
                              </UBadge>
                            </label>
                          </div>
                        </template>
                      </div>
                    </div>

                    <!-- 顶层叶子节点 -->
                    <div
                      v-else
                      class="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-elevated select-none"
                      :class="alreadyLinkedCodes.has(node.projectCode) ? 'opacity-50' : 'cursor-pointer'"
                    >
                      <div class="w-4 shrink-0" />
                      <label class="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                        <input
                          type="checkbox"
                          class="rounded border-default text-primary focus:ring-primary"
                          :checked="isSelected(node.projectCode) || alreadyLinkedCodes.has(node.projectCode)"
                          :disabled="alreadyLinkedCodes.has(node.projectCode)"
                          @change="toggleLeaf(node.projectCode)"
                        >
                        <UIcon name="i-lucide-git-branch" class="w-4 h-4 text-success shrink-0" />
                        <span class="text-sm truncate">{{ node.name }}</span>
                        <UBadge
                          v-if="alreadyLinkedCodes.has(node.projectCode)"
                          color="neutral"
                          variant="subtle"
                          size="xs"
                        >
                          已关联
                        </UBadge>
                      </label>
                    </div>
                  </template>
                </div>
              </div>
            </template>
            <template #footer>
              <div class="flex justify-end gap-2">
                <UButton
                  label="取消"
                  color="neutral"
                  variant="ghost"
                  @click="showAddRepoModal = false"
                />
                <UButton
                  :label="`关联${newSelectedCount > 0 ? ` (${newSelectedCount})` : ''}`"
                  color="primary"
                  :loading="addingRepo"
                  :disabled="newSelectedCount === 0"
                  @click="handleBatchLink"
                />
              </div>
            </template>
          </UModal>

          <!-- 文档预览弹窗 -->
          <UModal v-model:open="showDocPreview" :ui="{ content: 'sm:max-w-6xl', body: 'overflow-hidden p-0' }">
            <template #header>
              <span class="text-base font-medium">{{ previewDocTitle || '文档预览' }}</span>
            </template>
            <template #body>
              <div class="h-[70vh] rounded-lg border border-default bg-elevated/40 p-4 min-h-48">
                <AimsDocumentPreview
                  v-if="previewDocRef && showDocPreview"
                  :source="previewDocRef.source"
                  :codocs-uuid="previewDocRef.codocsUuid"
                  :project-id="projectId"
                  :repo-project-code="previewDocRef.repoProjectCode"
                  :repo-file-path="previewDocRef.repoFilePath"
                  :repo-commit-id="previewDocRef.repoCommitId"
                  :title="previewDocRef.title"
                />
              </div>
            </template>
            <template #footer>
              <div class="flex justify-end">
                <UButton
                  label="关闭"
                  color="neutral"
                  variant="ghost"
                  @click="showDocPreview = false"
                />
              </div>
            </template>
          </UModal>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
