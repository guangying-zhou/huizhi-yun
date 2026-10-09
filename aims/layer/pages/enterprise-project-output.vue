<script setup lang="ts">
import { projectPageFailure } from '../../app/utils/projectPageFailure'
import ProjectNavbar from '../../app/components/project/ProjectNavbar.vue'
import AimsDocumentPreview from '../../app/components/AimsDocumentPreview.vue'
import ProjectOutputRepositoryPicker from '../components/ProjectOutputRepositoryPicker.vue'
import { useProjectStore } from '../../app/stores/project'
import { useAimsModule } from '../useAimsModule'
import { deliverableStatusBadge, qualityStatusBadge, outputDeliverableStatus } from '../../app/utils/projectDeliverablePresentation'

type Deliverable = {
  id: number
  currentSubmissionId?: number | null
  currentReviewRoute?: string | null
  currentCompletenessPassed?: boolean
  name: string
  status: string
  qualityStatus: string
  required: boolean
  acceptanceCriteria?: string | null
  targetItemKey?: string | null
  targetTitle?: string | null
  matterItemKey?: string | null
  matterTitle?: string | null
  documentTitle?: string | null
  documentUuid?: string | null
  documentSource: 'codocs' | 'repo'
  repoProjectCode?: string | null
  repoFilePath?: string | null
  repoCommitId?: string | null
}
type Document = { id: number, uuid: string, title: string, codocsUuid?: string | null, documentSource?: string, repoProjectCode?: string | null, repoFilePath?: string | null, repoCommitId?: string | null, ossPath?: string | null }
type Repo = { id: number, repoProjectCode: string, lastCommitSha?: string | null, lastSyncedAt?: string | null }
type Overview = { items: Deliverable[], total: number, page: number, pageSize: number, stats: { total: number, approved: number, submitted: number, pending: number, rejected: number }, documents: Record<'project_proposal' | 'requirement_spec', Document | null>, repos: Repo[] }
type Preview = { source: 'codocs' | 'repo', codocsUuid?: string | null, repoProjectCode?: string | null, repoFilePath?: string | null, repoCommitId?: string | null, title?: string | null }
const route = useRoute()
const { moduleUrl } = useAimsModule()
const store = useProjectStore()
const { hasPermission } = usePermissions()
const canEdit = computed(() => hasPermission('projects', 'edit'))
const confirm = useConfirm()
const toast = useToast()
const projectId = computed(() => String(route.params.id || ''))
const page = ref(1)
const pageSize = 20
const overview = ref<Overview | null>(null)
const loading = ref(false)
const error = ref('')
const pickerOpen = ref(false)
const preview = ref<Preview | null>(null)
const previewOpen = ref(false)
const removing = ref('')
let requestSequence = 0
const cards = [{ key: 'project_proposal' as const, title: '项目立项书' }, { key: 'requirement_spec' as const, title: '需求规格书' }]
const columns = [{ accessorKey: 'name', header: '交付文档' }, { id: 'source', header: '来源' }, { id: 'requirement', header: '要求' }, { id: 'status', header: '状态' }, { id: 'document', header: '文档' }, { id: 'actions', header: '操作' }]
function showPreview(value: Preview) {
  preview.value = value
  previewOpen.value = true
}
function previewDeliverable(row: Deliverable) {
  showPreview({ source: row.documentSource, codocsUuid: row.documentUuid, repoProjectCode: row.repoProjectCode, repoFilePath: row.repoFilePath, repoCommitId: row.repoCommitId, title: row.documentTitle || row.name })
}
function previewDocument(doc: Document) {
  showPreview({ source: doc.documentSource === 'repo' ? 'repo' : 'codocs', codocsUuid: doc.codocsUuid || doc.uuid, repoProjectCode: doc.repoProjectCode, repoFilePath: doc.repoFilePath, repoCommitId: doc.repoCommitId, title: doc.title })
}
function canPreview(row: Deliverable) {
  return row.documentSource === 'repo' ? Boolean(row.repoProjectCode && row.repoFilePath && row.repoCommitId) : Boolean(row.documentUuid)
}
async function refresh() {
  const request = ++requestSequence
  loading.value = true
  error.value = ''
  overview.value = null
  try {
    const result = await $fetch<{ code: number, data: Overview }>(moduleUrl(`/api/v1/projects/${projectId.value}/output`), { query: { page: page.value, pageSize } })
    if (request !== requestSequence) return
    const data = result.data
    if (result.code !== 0 || !data || !Array.isArray(data.items) || !Array.isArray(data.repos) || !data.documents || !data.stats || data.page !== page.value || data.pageSize !== pageSize || !Number.isSafeInteger(data.total) || data.total < 0 || data.stats.total !== data.total) throw new Error('项目成果响应无效')
    overview.value = data
  } catch (cause) {
    if (request !== requestSequence) return
    error.value = projectPageFailure(cause, '项目成果暂不可用')
  } finally { if (request === requestSequence) loading.value = false }
}
async function unlinkRepo(repo: Repo) {
  if (!await confirm({ title: '解除仓库关联', message: `确定解除仓库 ${repo.repoProjectCode} 的关联？仅移除项目关联，不删除仓库或提交。`, confirmLabel: '解除关联', tone: 'danger' })) return
  removing.value = repo.repoProjectCode
  try {
    await store.unlinkRepo(Number(projectId.value), repo.repoProjectCode)
    await refresh()
    toast.add({ title: '仓库关联已解除', color: 'success' })
  } catch (cause) {
    toast.add({ title: '解除失败，可重试原操作', description: projectPageFailure(cause, '请求失败'), color: 'error' })
  } finally {
    removing.value = ''
  }
}
const qualityOpen = ref(false)
const qualityAction = ref<'submission' | 'completeness' | 'waiver'>('submission')
const qualityRow = ref<Deliverable | null>(null)
const qualityText = ref('')
const qualitySaving = ref(false)
const qualityError = ref('')
const qualityIntents = new Map<string, string>()
const canQuality = computed(() => hasPermission('projects', 'view'))
const canWaive = computed(() => hasPermission('quality_reviews', 'waive'))
const qualityTitle = computed(() => qualityAction.value === 'submission' ? '送检文档固定版本' : qualityAction.value === 'waiver' ? '质量豁免' : '完整性确认')
function openQuality(row: Deliverable, action: 'submission' | 'completeness' | 'waiver') {
  qualityRow.value = row
  qualityAction.value = action
  qualityText.value = ''
  qualityError.value = ''
  qualityOpen.value = true
}
async function writeQuality(decision: 'pass' | 'return' = 'pass') {
  const row = qualityRow.value
  if (!row || qualitySaving.value) return
  const action = qualityAction.value
  if ((action === 'waiver' || (action === 'completeness' && decision === 'return')) && !qualityText.value.trim()) {
    qualityError.value = '请填写原因或缺失项'
    return
  }
  if (action === 'waiver' && !await confirm({ title: '确认质量豁免', message: `将为交付文档“${row.name}”记录豁免及项目总监责任。豁免不是质量通过，原因将保留。`, tone: 'warning', confirmLabel: '记录豁免' })) return
  const payload = action === 'submission' ? {} : action === 'waiver' ? { reason: qualityText.value.trim() } : { action: decision, comment: qualityText.value.trim() }
  const target = action === 'completeness' ? row.currentSubmissionId : row.id
  if (!target) {
    qualityError.value = '缺少受检提交，请刷新后重试'
    return
  }
  const intent = JSON.stringify([projectId.value, action, target, payload])
  if (!qualityIntents.has(intent)) qualityIntents.set(intent, crypto.randomUUID())
  const suffix = action === 'completeness' ? `deliverable-submissions/${target}/confirm-completeness` : `deliverables/${target}/${action === 'waiver' ? 'waivers' : 'submissions'}`
  qualitySaving.value = true
  qualityError.value = ''
  try {
    const response = await $fetch<{ code: number }>(moduleUrl(`/api/v1/projects/${projectId.value}/${suffix}`), { method: 'POST', body: payload, headers: { 'Idempotency-Key': qualityIntents.get(intent)! } })
    if (response.code !== 0) throw new Error('质量操作未成功')
    qualityIntents.delete(intent)
    qualityOpen.value = false
    toast.add({ title: action === 'submission' ? '已送检固定版本' : action === 'waiver' ? '豁免已记录' : decision === 'pass' ? '完整性已确认' : '已退回补充', color: 'success' })
    await refresh()
  } catch (cause) {
    qualityError.value = projectPageFailure(cause, '操作失败，可重试原操作')
  } finally { qualitySaving.value = false }
}
watch(projectId, () => {
  previewOpen.value = false
  qualityOpen.value = false
  pickerOpen.value = false
  if (page.value === 1) refresh()
  else page.value = 1
})
watch(page, refresh)
onMounted(refresh)
</script>

<template>
  <UDashboardPanel id="enterprise-project-output" :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }">
    <template #body>
      <div class="flex h-full min-h-0 flex-col">
        <ProjectNavbar>
          <template #actions>
            <UButton
              aria-label="刷新"
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="ghost"
              size="sm"
              square
              :loading="loading"
              @click="refresh"
            />
          </template>
        </ProjectNavbar>
        <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-12 pt-4 sm:px-6">
          <section class="min-w-0 space-y-5">
            <UAlert
              v-if="error"
              color="error"
              title="无法读取项目成果"
              :description="error"
            />
            <USkeleton v-else-if="loading" class="h-40 w-full" />
            <template v-else-if="overview">
              <div class="grid gap-4 sm:grid-cols-2">
                <UCard v-for="card in cards" :key="card.key">
                  <h2 class="font-semibold">
                    {{ card.title }}
                  </h2>
                  <p class="mt-2 break-words text-sm text-muted">
                    {{ overview.documents[card.key]?.title || '暂未关联文档' }}
                  </p>
                  <template v-if="overview.documents[card.key]">
                    <UButton
                      v-if="!overview.documents[card.key]!.ossPath"
                      class="mt-3"
                      variant="soft"
                      size="sm"
                      @click="previewDocument(overview.documents[card.key]!)"
                    >
                      查看文档
                    </UButton>
                    <UButton
                      v-else
                      class="mt-3"
                      :to="moduleUrl(`/api/v1/projects/${projectId}/documents/${overview.documents[card.key]!.id}/download`)"
                      external
                      variant="soft"
                      size="sm"
                    >
                      下载附件
                    </UButton>
                  </template>
                </UCard>
              </div>
              <UCard :ui="{ body: 'p-0 sm:p-0' }">
                <template #header>
                  <h2 class="font-semibold">
                    交付文档
                  </h2>
                </template>
                <div class="grid grid-cols-2 gap-3 border-b border-default p-4 sm:grid-cols-4">
                  <p>已通过 <strong>{{ overview.stats.approved }}</strong></p><p>已提交 <strong>{{ overview.stats.submitted }}</strong></p><p>待提交 <strong>{{ overview.stats.pending }}</strong></p><p>总计 <strong>{{ overview.stats.total }}</strong></p>
                </div>
                <div class="max-w-full overflow-x-auto">
                  <UTable
                    :data="overview.items"
                    :columns="columns"
                    class="min-w-[760px]"
                    :ui="{ td: 'align-top' }"
                  >
                    <template #name-cell="{ row }">
                      <span class="block max-w-64 whitespace-normal break-words font-medium">{{ row.original.name }}</span>
                    </template>
                    <template #source-cell="{ row }">
                      <span class="block max-w-60 whitespace-normal break-words">{{ [row.original.targetItemKey || row.original.matterItemKey, row.original.targetTitle || row.original.matterTitle].filter(Boolean).join(' · ') || '项目 / 里程碑' }}</span>
                    </template>
                    <template #requirement-cell="{ row }">
                      <UBadge :color="row.original.required ? 'warning' : 'neutral'" variant="soft">
                        {{ row.original.required ? '必需' : '可选' }}
                      </UBadge><p class="mt-1 max-w-60 whitespace-normal break-words text-sm text-muted">
                        {{ row.original.acceptanceCriteria || '未填写验收要求' }}
                      </p>
                    </template>
                    <template #status-cell="{ row }">
                      <div class="flex flex-col items-start gap-1">
                        <UBadge :color="deliverableStatusBadge(outputDeliverableStatus(row.original)).color" variant="soft">
                          {{ deliverableStatusBadge(outputDeliverableStatus(row.original)).label }}
                        </UBadge><UBadge :color="qualityStatusBadge(row.original.qualityStatus, row.original.status).color" variant="soft">
                          {{ qualityStatusBadge(row.original.qualityStatus, row.original.status).label }}
                        </UBadge>
                      </div>
                    </template>
                    <template #document-cell="{ row }">
                      <UButton
                        v-if="canPreview(row.original)"
                        variant="link"
                        class="max-w-64 whitespace-normal break-words text-left"
                        @click="previewDeliverable(row.original)"
                      >
                        {{ row.original.documentTitle || row.original.repoFilePath || '查看文档' }}
                      </UButton><span v-else class="text-muted">{{ row.original.documentSource === 'repo' && row.original.repoFilePath ? '未固定仓库版本' : '未关联文档' }}</span>
                    </template>
                    <template #actions-cell="{ row }">
                      <div class="flex flex-wrap gap-1">
                        <UButton
                          v-if="canQuality && canPreview(row.original) && !['awaiting_review', 'passed', 'waived'].includes(row.original.qualityStatus)"
                          size="xs"
                          variant="soft"
                          @click="openQuality(row.original, 'submission')"
                        >
                          送检
                        </UButton>
                        <UButton
                          v-if="canQuality && row.original.currentSubmissionId && row.original.qualityStatus === 'awaiting_review' && row.original.currentReviewRoute === 'pm_completeness_then_director_quality' && !row.original.currentCompletenessPassed"
                          size="xs"
                          variant="soft"
                          @click="openQuality(row.original, 'completeness')"
                        >
                          完整性确认
                        </UButton>
                        <UButton
                          v-if="canWaive && !['passed', 'waived'].includes(row.original.qualityStatus)"
                          size="xs"
                          color="warning"
                          variant="soft"
                          @click="openQuality(row.original, 'waiver')"
                        >
                          豁免
                        </UButton>
                      </div>
                      <UButton :to="moduleUrl(`/projects/${projectId}/output/${row.original.id}`)" variant="soft" size="sm">
                        详情
                      </UButton>
                    </template>
                    <template #empty>
                      <p class="py-6 text-muted">
                        暂无交付文档
                      </p>
                    </template>
                  </UTable>
                </div>
                <div class="flex flex-wrap items-center justify-between gap-3 p-4">
                  <span class="text-sm text-muted">共 {{ overview.total }} 条</span><UPagination
                    v-model:page="page"
                    :items-per-page="pageSize"
                    :total="overview.total"
                    :sibling-count="1"
                  />
                </div>
              </UCard>

              <UCard>
                <template #header>
                  <div class="flex flex-wrap items-center justify-between gap-3">
                    <h2 class="font-semibold">
                      代码仓库
                    </h2><UButton
                      v-if="canEdit"
                      icon="i-lucide-link"
                      size="sm"
                      @click="pickerOpen = true"
                    >
                      关联仓库
                    </UButton>
                  </div>
                </template>
                <p v-if="!overview.repos.length" class="text-sm text-muted">
                  暂未关联代码仓库
                </p>
                <ul v-else class="space-y-3">
                  <li v-for="repo in overview.repos" :key="repo.id" class="flex min-w-0 flex-wrap items-center justify-between gap-3">
                    <div class="min-w-0">
                      <p class="break-all font-medium">
                        {{ repo.repoProjectCode }}
                      </p><p class="text-sm text-muted">
                        最近同步：{{ repo.lastSyncedAt || '尚未同步' }}<span v-if="repo.lastCommitSha"> · {{ repo.lastCommitSha.slice(0, 8) }}</span>
                      </p>
                    </div>
                    <UButton
                      v-if="canEdit"
                      color="error"
                      variant="ghost"
                      size="sm"
                      :loading="removing === repo.repoProjectCode"
                      :disabled="Boolean(removing)"
                      @click="unlinkRepo(repo)"
                    >
                      解除关联
                    </UButton>
                  </li>
                </ul>
              </UCard>
            </template>
            <UModal v-model:open="qualityOpen" :title="qualityTitle" :dismissible="!qualitySaving">
              <template #body>
                <div class="space-y-4">
                  <p class="break-words">
                    {{ qualityRow?.name }}
                  </p>
                  <UAlert
                    v-if="qualityAction === 'submission'"
                    color="info"
                    title="受检版本将冻结"
                    description="Codocs 使用正式解析的最新确定版本；仓库使用已绑定的固定提交。后续编辑不会改变本次受检快照。"
                  />
                  <UAlert
                    v-if="qualityAction === 'completeness'"
                    color="info"
                    title="只确认材料完整性"
                    description="当前项目经理或有效代理确认后仍须由项目总监审核质量；退回必须填写缺失项。"
                  />
                  <UFormField v-if="qualityAction !== 'submission'" :label="qualityAction === 'waiver' ? '豁免原因' : '确认说明或缺失项'" :required="qualityAction === 'waiver'">
                    <UTextarea
                      v-model="qualityText"
                      :disabled="qualitySaving"
                      :maxlength="qualityAction === 'waiver' ? 1000 : 4000"
                      class="w-full"
                    />
                  </UFormField>
                  <UAlert v-if="qualityError" color="error" :title="qualityError" />
                </div>
              </template>
              <template #footer>
                <UButton variant="ghost" :disabled="qualitySaving" @click="qualityOpen = false">
                  取消
                </UButton>
                <UButton
                  v-if="qualityAction === 'completeness'"
                  color="warning"
                  :loading="qualitySaving"
                  :disabled="qualitySaving"
                  @click="writeQuality('return')"
                >
                  退回补充
                </UButton>
                <UButton :loading="qualitySaving" :disabled="qualitySaving" @click="writeQuality('pass')">
                  {{ qualityAction === 'submission' ? '提交检查' : qualityAction === 'waiver' ? '记录豁免' : '确认完整' }}
                </UButton>
              </template>
            </UModal>
            <ProjectOutputRepositoryPicker
              v-model:open="pickerOpen"
              :project-id="projectId"
              :linked-codes="overview?.repos.map(repo => repo.repoProjectCode) || []"
              @linked="refresh"
            />
            <UModal
              v-model:open="previewOpen"
              :title="preview?.title || '文档预览'"
              description="读取当前权限允许的文档内容，仓库正文使用已保存提交。"
              :ui="{ content: 'sm:max-w-4xl' }"
            >
              <template #body>
                <AimsDocumentPreview v-if="preview && previewOpen" v-bind="preview" :project-id="Number(projectId)" />
              </template>
            </UModal>
          </section>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
