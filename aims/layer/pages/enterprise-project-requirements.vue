<script setup lang="ts">
import CreateTaskDialog from '../../app/components/requirements/task/CreateTaskDialog.vue'
import ProjectNavbar from '../../app/components/project/ProjectNavbar.vue'
import ChapterTree from '../../app/components/requirements/spec/ChapterTree.vue'
import ChapterPreview from '../../app/components/requirements/spec/ChapterPreview.vue'
import CreateRequirementModal from '../../app/components/requirements/spec/CreateRequirementModal.vue'
import ImportWizard from '../../app/components/requirements/import/Wizard.vue'
import { useRequirements, useRequirementSpec, type ContentTreeNode, type RequirementItem } from '../../app/composables/useRequirements'
import { useRequirementIntent } from '../../app/composables/useRequirementIntent'
import { useProjectStore } from '../../app/stores/project'
import { statusLabel, statusColor, typeLabel, sourceLabel } from '../../app/config/requirement'
import { useAimsModule } from '../useAimsModule'

const route = useRoute()
const projectId = computed(() => Number(route.params.id))
const { moduleUrl } = useAimsModule()
const { mutate } = useRequirementIntent()
const store = useProjectStore()
const { user: actorUid } = useAuth()
const { hasPermission, loadPermissions } = usePermissions()
const { confirm } = useConfirm()
const toast = useToast()
const tab = ref(['spec', 'list', 'review'].includes(String(route.query.tab)) ? String(route.query.tab) : 'list')
const tabs = [{ label: '规格书', value: 'spec' }, { label: '需求列表', value: 'list' }, { label: '需求评审', value: 'review' }]
const list = useRequirements(projectId)
const specification = useRequirementSpec(projectId)
const { items, total, filters, loading, baselineSummary } = list
const { spec, contents, linkedRequirements, contentTree } = specification
const error = ref('')
interface ReviewBatch {
  id: number
  title: string
  batchType: string
  submittedBy: string
  status: string
  workflowInstanceId: string | null
  requirements: {
    id: number
    title: string
    reqCode: string
  }[]
}
interface VersionRow {
  id: number
  versionNo: number
  changeType: string
  changeReason: string | null
  createdAt: string
  snapshot: Record<string, unknown>
}
interface ImpactTask {
  id: number
  itemKey: string
  title: string
  status: string
  impactCategory: string
}
interface DiffRow {
  base: {
    title: string
    contentMd: string | null
  } | null
  change: {
    id: number
    title: string
    contentMd: string | null
  }
  diffStatus: string
}
const reviews = ref<ReviewBatch[]>([])
const selectedRequirements = ref<number[]>([])
const showBatch = ref(false)
const batchForm = reactive({ title: '', description: '', batchType: 'baseline' })
const detail = ref<RequirementItem | null>(null)
const showDetail = ref(false)
const versions = ref<VersionRow[]>([])
const impact = ref<ImpactTask[]>([])
const diffs = ref<DiffRow[]>([])
const showChange = ref(false)
const changeForm = reactive({ reason: '', contents: [] as {
  contentId: number
  title: string
  contentMd: string
}[] })
const showTask = ref(false)
const taskMilestones = ref<{
  id: number
  name: string
  pivrStage: string | null
}[]>([])
const taskUsers = ref<{
  uid: string
  realName?: string
}[]>([])
async function requirementRead<T>(suffix: string, reqId: number) {
  return (await $fetch<{
    code: number
    data: T
  }>(moduleUrl(`/api/v1/requirements/${reqId}/${suffix}`), { query: { projectId: projectId.value } })).data
}
async function loadReviews() {
  reviews.value = (await $fetch<{
    code: number
    data: {
      batches: ReviewBatch[]
    }
  }>(moduleUrl(`/api/v1/projects/${projectId.value}/requirement-reviews`))).data.batches
}
async function openDetail(item: RequirementItem) {
  detail.value = item
  versions.value = []
  impact.value = []
  diffs.value = []
  showDetail.value = true
  try {
    const [history, affected] = await Promise.all([requirementRead<VersionRow[]>('versions', item.id), requirementRead<{
      linkedTasks: ImpactTask[]
    }>('change-impact', item.id)])
    versions.value = history.map(version => ({ ...version, snapshot: version.snapshot && typeof version.snapshot === 'object' ? version.snapshot : {} }))
    impact.value = affected.linkedTasks
    if (item.itemKind === 'change')
      diffs.value = (await requirementRead<{
        items: DiffRow[]
      }>('change-diff', item.id)).items
  } catch {
    toast.add({ title: '版本或变更信息读取失败', color: 'error' })
  }
}
async function openChange() {
  if (!detail.value)
    return
  try {
    const value = (await $fetch<{
      code: number
      data: {
        contents: {
          id: number
          title: string
          contentMd: string | null
        }[]
      }
    }>(moduleUrl(`/api/v1/projects/${projectId.value}/requirements/${detail.value.id}`))).data
    changeForm.reason = ''
    changeForm.contents = value.contents.map(c => ({ contentId: c.id, title: c.title, contentMd: c.contentMd || '' }))
    showChange.value = true
  } catch {
    toast.add({ title: '需求章节读取失败', color: 'error' })
  }
}
async function saveChange() {
  if (saving.value || !detail.value || !changeForm.contents.length)
    return
  saving.value = true
  try {
    await mutate(`/api/v1/requirements/${detail.value.id}/changes`, 'POST', { reason: changeForm.reason, contents: changeForm.contents }, projectId.value)
    showChange.value = false
    showDetail.value = false
    await refresh()
  } catch {
    toast.add({ title: '创建变更失败，请按相同内容重试', color: 'error' })
  } finally {
    saving.value = false
  }
}
async function openTask() {
  if (!detail.value)
    return
  try {
    const [milestones, members] = await Promise.all([$fetch<{
      code: number
      data: {
        milestones: typeof taskMilestones.value
      }
    }>(moduleUrl(`/api/v1/projects/${projectId.value}/milestones`)), store.fetchMembers(projectId.value)])
    taskMilestones.value = milestones.data.milestones
    taskUsers.value = members.map(m => ({ uid: m.uid, realName: m.realName || m.uid }))
    showTask.value = true
  } catch {
    toast.add({ title: '任务选项读取失败', color: 'error' })
  }
}
function taskCreated() {
  showTask.value = false
  showDetail.value = false
  refresh()
}
async function createBatch() {
  if (saving.value || !selectedRequirements.value.length)
    return
  saving.value = true
  try {
    await mutate(`/api/v1/projects/${projectId.value}/requirement-reviews`, 'POST', { ...batchForm, ...(!batchForm.title.trim() ? { title: undefined } : {}), requirementIds: selectedRequirements.value }, projectId.value)
    showBatch.value = false
    selectedRequirements.value = []
    await refresh()
  } catch {
    toast.add({ title: '创建批次失败，请按相同内容重试', color: 'error' })
  } finally {
    saving.value = false
  }
}
async function appendBatch(batch: ReviewBatch) {
  if (!selectedRequirements.value.length)
    return
  try {
    await mutate(`/api/v1/requirement-reviews/${batch.id}/append`, 'POST', { requirementIds: selectedRequirements.value }, projectId.value)
    selectedRequirements.value = []
    await refresh()
  } catch {
    toast.add({ title: '追加需求失败', color: 'error' })
  }
}
async function withdrawBatch(batch: ReviewBatch) {
  if (!await confirm({ title: '撤回准备批次', message: `确认撤回“${batch.title}”？所含需求将恢复草稿；已提交 Workflow 的批次不能直接撤回。`, tone: 'warning' }))
    return
  try {
    await mutate(`/api/v1/requirement-reviews/${batch.id}/withdraw`, 'POST', {}, projectId.value)
    await refresh()
  } catch {
    toast.add({ title: '撤回失败', color: 'error' })
  }
}
async function syncBatch(batch: ReviewBatch) {
  if (saving.value) return
  saving.value = true
  try {
    await mutate(`/api/v1/requirement-reviews/${batch.id}/sync-workflow`, 'POST', {}, projectId.value)
    toast.add({ title: '评审已提交或同步，结果由 Workflow 正式回写', color: 'success' })
    await refresh()
  } catch {
    toast.add({ title: '评审提交未确认，请按同一批次重试', color: 'error' })
  } finally {
    saving.value = false
  }
}
async function createBatchTasks(batch: ReviewBatch) {
  if (saving.value) return
  if (!await confirm({ title: '生成需求任务', message: `为“${batch.title}”生成任务？已有任务的需求不会重复生成。`, tone: 'warning' })) return
  saving.value = true
  try {
    const result = await mutate<{ code: number, data: { createdCount: number, skippedCount: number } }>(`/api/v1/requirement-reviews/${batch.id}/create-tasks`, 'POST', {}, projectId.value)
    toast.add({ title: `已生成 ${result.data.createdCount} 条任务，跳过 ${result.data.skippedCount} 条`, color: 'success' })
    await refresh()
  } catch {
    toast.add({ title: '生成任务未确认，请按同一内容重试', color: 'error' })
  } finally {
    saving.value = false
  }
}
async function resolveBatch(batch: ReviewBatch) {
  try {
    const res = await $fetch<{
      code: number
      data: {
        projectId: number
      }
    }>(moduleUrl(`/api/v1/requirement-reviews/${batch.id}/resolve`), { query: { projectId: projectId.value } })
    if (res.data.projectId !== projectId.value)
      throw Error('project mismatch')
    toast.add({ title: `批次属于当前项目：${store.currentProject?.name || projectId.value}`, color: 'success' })
  } catch {
    toast.add({ title: '批次归属读取失败', color: 'error' })
  }
}
function selectRequirement(item: RequirementItem) {
  selectedRequirements.value = selectedRequirements.value.includes(item.id) ? selectedRequirements.value.filter(id => id !== item.id) : [...selectedRequirements.value, item.id]
}
const checkedIds = ref(new Set<number>())
const selectedId = ref<number | null>(null)
const includeDeleted = ref(false)
const showImport = ref(false)
const showContentCreate = ref(false)
const showRequirement = ref(false)
const saving = ref(false)
const editing = ref<number | null>(null)
const form = reactive({ title: '', type: 'functional', priority: 'P2', source: 'internal' })
const targets = ref<{
  id: number
  title: string
  status: string
  isBaseline: boolean
  milestoneId: number | null
}[]>([])
const targetId = ref<number | undefined>()
const activeTarget = computed(() => targets.value.find(t => t.id === targetId.value))
const canWrite = computed(() => hasPermission('requirements', 'edit') && store.currentProject?.lifecycleStatus === 'active' && (store.currentProject?.leaderUid === actorUid.value || store.currentProject?.currentUserRole === 'manager' || store.currentProject?.currentUserIsProjectAdmin))
const canEditSpec = computed(() => Boolean(canWrite.value && (!activeTarget.value || activeTarget.value.isBaseline) && !['reviewing', 'in_review', 'confirmed', 'completed'].includes(activeTarget.value?.status || '')))
const selectedChapters = computed(() => {
  const nodes: ContentTreeNode[] = []
  function walk(tree: ContentTreeNode[]) {
    for (const node of tree) {
      nodes.push(node)
      walk(node.children)
    }
  }
  walk(contentTree.value)
  return nodes.filter(node => checkedIds.value.size ? checkedIds.value.has(node.id) : node.id === selectedId.value)
})
async function refresh() {
  error.value = ''
  try {
    await Promise.all([list.fetchList(), specification.fetchSpec({ includeDeleted: includeDeleted.value }), loadReviews()])
  } catch {
    error.value = '项目需求暂不可用，请稍后重试'
  }
}
async function initialize() {
  checkedIds.value = new Set()
  selectedId.value = null
  targetId.value = undefined
  targets.value = []
  selectedRequirements.value = []
  reviews.value = []
  showDetail.value = false
  try {
    await Promise.all([loadPermissions(), store.fetchProject(projectId.value)])
    const result = await $fetch<{
      code: number
      data: {
        items: typeof targets.value
      }
    }>(moduleUrl(`/api/v1/projects/${projectId.value}/requirement-targets`))
    if (result.code !== 0)
      throw Error('targets unavailable')
    targets.value = result.data.items
    await refresh()
  } catch {
    error.value = '项目需求暂不可用，请稍后重试'
  }
}
function openRequirement(item?: RequirementItem) {
  editing.value = item?.id ?? null
  Object.assign(form, { title: item?.title || '', type: item?.type || 'functional', priority: item?.priority || 'P2', source: item?.source || 'internal' })
  showRequirement.value = true
}
async function saveRequirement() {
  if (saving.value || !form.title.trim())
    return
  saving.value = true
  try {
    await mutate(editing.value ? `/api/v1/requirements/${editing.value}` : `/api/v1/projects/${projectId.value}/requirements`, editing.value ? 'PATCH' : 'POST', { ...form, title: form.title.trim(), ...(!editing.value && targetId.value ? { workItemId: targetId.value } : {}) }, projectId.value)
    showRequirement.value = false
    await refresh()
  } catch {
    toast.add({ title: '保存失败，请按相同内容重试', color: 'error' })
  } finally {
    saving.value = false
  }
}
async function deleteRequirement(item: RequirementItem) {
  if (!await confirm({ title: '删除需求', message: `确认删除“${item.title}”？草稿将删除，章节内容保留；已基线或评审中的需求不能删除。`, tone: 'danger' }))
    return
  try {
    await mutate(`/api/v1/requirements/${item.id}`, 'DELETE', {}, projectId.value)
    await refresh()
  } catch {
    toast.add({ title: '删除失败', color: 'error' })
  }
}
watch(projectId, initialize)
watch(includeDeleted, refresh)
watch(targetId, () => {
  filters.workItemId = targetId.value ? String(targetId.value) : ''
  filters.page = 1
  refresh()
})
function applyFilters() {
  filters.page = 1
  refresh()
}
function imported() {
  showImport.value = false
  refresh()
}
function contentCreated() {
  showContentCreate.value = false
  refresh()
}
onMounted(initialize)
</script>

<template>
  <UDashboardPanel id="enterprise-project-requirements" :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }">
    <template #body>
      <div class="flex h-full min-h-0 min-w-0 flex-col">
        <ProjectNavbar>
          <template #actions>
            <UButton
              icon="i-lucide-refresh-cw"
              aria-label="刷新"
              color="neutral"
              variant="ghost"
              :loading="loading"
              @click="refresh"
            />
          </template>
        </ProjectNavbar>
        <div class="min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
          <UAlert
            v-if="error"
            color="error"
            title="无法读取需求"
            :description="error"
          />
          <UTabs v-model="tab" :items="tabs" :content="false" />
          <USelect
            v-if="tab !== 'review' && targets.length"
            v-model="targetId"
            :items="targets.map(t => ({ label: t.title, value: t.id }))"
            placeholder="全部需求批次"
            class="w-full sm:w-80"
          />
          <UButton
            v-if="targetId"
            label="全部需求批次"
            color="neutral"
            variant="ghost"
            @click="targetId = undefined"
          />
          <section v-if="tab === 'spec'" class="space-y-4">
            <div class="flex flex-wrap items-center gap-3">
              <h2 class="min-w-0 break-words font-semibold">
                {{ spec?.title || '需求规格书' }}
              </h2>
              <UButton
                v-if="canEditSpec"
                label="导入规格书"
                icon="i-lucide-file-down"
                @click="showImport = true"
              />
              <UButton
                v-if="canEditSpec"
                label="新增模块/功能项"
                variant="soft"
                @click="showContentCreate = true"
              />
              <UCheckbox v-model="includeDeleted" label="显示已删除章节" />
            </div>
            <div class="grid min-w-0 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
              <ChapterTree
                :nodes="contentTree"
                :linked-requirements="linkedRequirements"
                :checked-ids="checkedIds"
                :selected-id="selectedId"
                :highlight-req-id="null"
                @update:checked-ids="checkedIds = $event"
                @click="selectedId = $event"
              />
              <ChapterPreview
                :chapters="selectedChapters"
                :all-contents="contents"
                :linked-requirements="linkedRequirements"
                :project-id="projectId"
                :can-edit-spec="canEditSpec"
                :can-set-requirement="canEditSpec"
                :is-partial="false"
                :viewing-req-id="null"
                :active-target-id="targetId"
                :default-milestone-id="activeTarget?.milestoneId"
                :allow-changes="false"
                @updated="refresh"
              />
            </div>
          </section>
          <section v-else-if="tab === 'list'" class="space-y-4">
            <div class="flex flex-wrap gap-2">
              <UInput v-model="filters.search" placeholder="搜索编号或标题" @keyup.enter="applyFilters" />
              <USelect v-model="filters.status" :items="[{ label: '有效需求', value: 'active' }, { label: '全部状态', value: 'all' }, ...Object.entries(statusLabel).map(([value, label]) => ({ value, label }))]" />
              <USelect v-model="filters.type" :items="[{ label: '全部类型', value: 'all' }, ...Object.entries(typeLabel).map(([value, label]) => ({ value, label }))]" />
              <UButton label="查询" :loading="loading" @click="applyFilters" />
              <UButton
                v-if="canWrite"
                label="新建需求"
                icon="i-lucide-plus"
                @click="openRequirement()"
              />
            </div>
            <p class="text-sm text-muted">
              草稿 {{ baselineSummary.draftCount }} · 已基线 {{ baselineSummary.baselinedCount }} · 待评审批次 {{ baselineSummary.pendingBatchCount }}
            </p>
            <UTable :data="items" :loading="loading" :columns="[{ accessorKey: 'reqCode', header: '编号' }, { accessorKey: 'title', header: '标题' }, { accessorKey: 'type', header: '类型' }, { accessorKey: 'priority', header: '优先级' }, { accessorKey: 'source', header: '来源' }, { accessorKey: 'status', header: '状态' }, { id: 'actions', header: '操作' }]">
              <template #empty>
                <CommonEmptyState
                  icon="i-lucide-list-checks"
                  title="暂无需求"
                  description="当前筛选条件下没有需求记录。"
                />
              </template>
              <template #reqCode-cell="{ row }">
                <NuxtLink class="text-primary hover:underline" :to="moduleUrl(`/projects/${projectId}/requirements/${row.original.id}`)">{{ row.original.reqCode }}</NuxtLink>
              </template>
              <template #type-cell="{ row }">
                {{ typeLabel[row.original.type] }}
              </template>
              <template #source-cell="{ row }">
                {{ sourceLabel[row.original.source] }}
              </template>
              <template #status-cell="{ row }">
                <UBadge :color="statusColor[row.original.status] || 'neutral'">
                  {{ statusLabel[row.original.status] }}
                </UBadge>
              </template>
              <template #actions-cell="{ row }">
                <div class="flex flex-wrap gap-1">
                  <UButton
                    label="版本与影响"
                    size="xs"
                    variant="ghost"
                    @click="openDetail(row.original)"
                  />
                  <UButton
                    v-if="canWrite && row.original.status === 'draft'"
                    :label="selectedRequirements.includes(row.original.id) ? '取消选择' : '选择评审'"
                    size="xs"
                    variant="ghost"
                    @click="selectRequirement(row.original)"
                  />
                  <UButton
                    v-if="canWrite && row.original.status === 'draft'"
                    label="编辑"
                    size="xs"
                    variant="ghost"
                    @click="openRequirement(row.original)"
                  /><UButton
                    v-if="canWrite && !['in_review', 'change_pending', 'baselined', 'deprecated'].includes(row.original.status)"
                    label="删除"
                    size="xs"
                    color="error"
                    variant="ghost"
                    @click="deleteRequirement(row.original)"
                  />
                </div>
              </template>
            </UTable>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <span class="text-sm text-muted">共 {{ total }} 条</span><UPagination
                v-model:page="filters.page"
                :items-per-page="filters.pageSize"
                :total="total"
                @update:page="refresh"
              />
            </div>
          </section>
          <section v-else>
            <UAlert color="info" title="需求评审" description="发起人可提交或同步正式审批；结果由 Workflow 服务端回写，不能由浏览器写入。准备提交后需求集合冻结，不能再追加或撤回准备。" />
            <div class="my-4 flex flex-wrap items-center gap-2">
              <span class="text-sm text-muted">需求列表中已选择 {{ selectedRequirements.length }} 条</span><UButton
                v-if="canWrite"
                label="创建准备批次"
                :disabled="!selectedRequirements.length"
                @click="showBatch=true"
              />
            </div>
            <UEmpty v-if="!reviews.length" title="暂无评审批次" />
            <UCard v-for="batch in reviews" :key="batch.id" class="mb-3 min-w-0">
              <div class="flex flex-wrap items-center justify-between gap-2">
                <h3 class="break-words font-semibold">
                  {{ batch.title }}
                </h3><UBadge color="neutral">
                  {{ batch.status === 'pending' ? '待评审' : batch.status === 'approved' ? '已通过' : batch.status === 'rejected' ? '已退回' : batch.status }}
                </UBadge>
              </div><ul class="my-3 text-sm">
                <li v-for="req in batch.requirements" :key="req.id" class="break-words">
                  {{ req.reqCode }} · {{ req.title }}
                </li>
              </ul><div class="flex flex-wrap gap-2">
                <UButton
                  label="核对项目归属"
                  color="neutral"
                  variant="ghost"
                  @click="resolveBatch(batch)"
                /><UButton
                  v-if="canWrite && batch.status === 'pending' && batch.submittedBy === actorUid"
                  :label="batch.workflowInstanceId ? '同步评审' : '提交评审'"
                  :loading="saving"
                  @click="syncBatch(batch)"
                />
                <UButton
                  v-if="canWrite && batch.status === 'approved'"
                  label="生成任务"
                  :loading="saving"
                  @click="createBatchTasks(batch)"
                />
                <template v-if="canWrite && batch.status === 'pending' && !batch.workflowInstanceId">
                  <UButton
                    v-if="batch.batchType === 'baseline'"
                    label="追加所选需求"
                    :disabled="!selectedRequirements.length"
                    variant="soft"
                    @click="appendBatch(batch)"
                  /><UButton
                    label="撤回准备"
                    color="warning"
                    variant="soft"
                    @click="withdrawBatch(batch)"
                  />
                </template>
              </div>
            </UCard>
          </section>
          <UModal v-model:open="showDetail" :title="detail?.title || '需求版本与影响'" description="查看正式版本记录与关联任务，不在此写入评审结果。">
            <template #body>
              <div class="space-y-4">
                <h3 class="font-semibold">
                  版本历史
                </h3><UEmpty v-if="!versions.length" title="暂无正式版本" /><UCard v-for="version in versions" :key="version.id">
                  <p>版本 {{ version.versionNo }} · {{ version.createdAt }}</p><p class="break-words text-sm">
                    {{ version.changeReason || '基线版本' }}
                  </p><dl class="mt-2 text-sm">
                    <dt class="text-muted">
                      标题
                    </dt><dd class="break-words">
                      {{ version.snapshot.title }}
                    </dd><dt class="text-muted">
                      优先级
                    </dt><dd>{{ version.snapshot.priority }}</dd><dt class="text-muted">
                      类型
                    </dt><dd>{{ typeLabel[String(version.snapshot.type)] || '—' }}</dd><dt class="text-muted">
                      来源
                    </dt><dd>{{ sourceLabel[String(version.snapshot.source)] || '—' }}</dd>
                  </dl>
                </UCard><h3 class="font-semibold">
                  关联任务影响
                </h3><p v-if="!impact.length" class="text-sm text-muted">
                  没有关联任务
                </p><div v-for="task in impact" :key="task.id" class="break-words text-sm">
                  {{ task.itemKey }} · {{ task.title }} · {{ task.impactCategory === 'safe_to_update' ? '可安全更新' : task.impactCategory === 'user_choice' ? '需选择处理方式' : '必须走变更申请' }}
                </div><div v-for="diff in diffs" :key="diff.change.id" class="grid min-w-0 gap-3 sm:grid-cols-2">
                  <UCard>
                    <p class="font-semibold">
                      原版本 · {{ diff.base?.title || '新增章节' }}
                    </p><p class="break-words whitespace-pre-wrap text-sm">
                      {{ diff.base?.contentMd }}
                    </p>
                  </UCard><UCard>
                    <p class="font-semibold">
                      变更版本 · {{ diff.change.title }}
                    </p><p class="break-words whitespace-pre-wrap text-sm">
                      {{ diff.change.contentMd }}
                    </p>
                  </UCard>
                </div>
              </div>
            </template><template #footer>
              <UButton v-if="canWrite && detail?.status === 'baselined'" label="创建变更" @click="openChange" /><UButton v-if="canWrite && detail?.status === 'baselined' && !detail?.taskItemKey" label="生成任务" @click="openTask" />
            </template>
          </UModal>
          <UModal v-model:open="showBatch" title="创建准备批次" description="保存评审准备，不会提交或批准 Workflow。">
            <template #body>
              <div class="space-y-3">
                <UFormField label="标题（可选）">
                  <UInput v-model="batchForm.title" class="w-full" />
                </UFormField><UFormField label="说明">
                  <UTextarea v-model="batchForm.description" class="w-full" />
                </UFormField><UFormField label="类型">
                  <USelect v-model="batchForm.batchType" :items="[{ label: '基线评审', value: 'baseline' }, { label: '变更评审', value: 'change' }]" />
                </UFormField>
              </div>
            </template><template #footer>
              <UButton label="保存准备批次" :loading="saving" @click="createBatch" />
            </template>
          </UModal>
          <UModal v-model:open="showChange" title="创建需求变更" description="修改基线章节并创建变更草稿，评审结果只能由正式 Workflow 回写。">
            <template #body>
              <UFormField label="变更原因">
                <UTextarea v-model="changeForm.reason" class="w-full" />
              </UFormField><div v-for="chapter in changeForm.contents" :key="chapter.contentId" class="mt-4 space-y-2">
                <UFormField label="章节标题">
                  <UInput v-model="chapter.title" class="w-full" />
                </UFormField><UFormField label="章节正文">
                  <UTextarea v-model="chapter.contentMd" class="w-full" :rows="6" />
                </UFormField>
              </div>
            </template><template #footer>
              <UButton
                label="创建变更草稿"
                :disabled="!changeForm.contents.length"
                :loading="saving"
                @click="saveChange"
              />
            </template>
          </UModal>
          <CreateTaskDialog
            v-if="showTask && detail"
            :requirement="detail"
            :project-id="projectId"
            :milestones="taskMilestones"
            :users="taskUsers"
            @close="showTask=false"
            @created="taskCreated"
          />
          <ImportWizard
            v-if="showImport"
            :project-id="projectId"
            :work-item-id="targetId"
            @close="showImport = false"
            @imported="imported"
          />
          <CreateRequirementModal
            v-if="showContentCreate"
            :project-id="projectId"
            :heading-levels="spec?.headingLevels"
            :contents="contents"
            :selected-content-id="selectedId"
            @close="showContentCreate = false"
            @created="contentCreated"
          />
          <UModal v-model:open="showRequirement" :title="editing ? '编辑需求' : '新建需求'" description="保存需求基本信息；正式评审结果须由 Workflow 回写。">
            <template #body>
              <div class="space-y-4">
                <UFormField label="标题" required>
                  <UInput v-model="form.title" class="w-full" />
                </UFormField><UFormField label="类型">
                  <USelect v-model="form.type" :items="Object.entries(typeLabel).map(([value, label]) => ({ value, label }))" />
                </UFormField><UFormField label="优先级">
                  <USelect v-model="form.priority" :items="['P0', 'P1', 'P2', 'P3']" />
                </UFormField><UFormField label="来源">
                  <USelect v-model="form.source" :items="Object.entries(sourceLabel).map(([value, label]) => ({ value, label }))" />
                </UFormField>
              </div>
            </template>
            <template #footer>
              <UButton
                label="取消"
                color="neutral"
                variant="ghost"
                @click="showRequirement = false"
              /><UButton
                label="保存"
                :loading="saving"
                :disabled="!form.title.trim()"
                @click="saveRequirement"
              />
            </template>
          </UModal>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
