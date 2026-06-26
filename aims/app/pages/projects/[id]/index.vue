<script setup lang="ts">
import { PROJECT_ROLE_COLORS, PROJECT_ROLE_LABELS } from '~/utils/projectRoles'

definePageMeta({
  layoutHeader: true,
  layoutHeaderTitle: '概览',
  layoutHeaderProjectSwitcher: true
})

const route = useRoute()
const { resolveCurrentAppUrl } = useAppUrls()
const projectStore = useProjectStore()
const milestoneStore = useMilestoneStore()
const { users: accountUsers } = useAccountUsers()
const { flat: deptFlat } = useAccountDepartments()

const projectId = computed(() => Number(route.params.id))

// ========================
// Name & code resolution helpers
// ========================
const userNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const u of accountUsers.value) {
    map.set(u.uid, u.realName?.trim() || u.uid)
  }
  return map
})

function getUserName(uid: string | null | undefined) {
  if (!uid) return '-'
  return userNameMap.value.get(uid) || uid
}

const deptNameMap = computed(() => {
  const map = new Map<string, string>()
  for (const d of deptFlat.value) {
    if (d.deptCode) map.set(d.deptCode, d.name)
  }
  return map
})

function getDeptName(code: string | null | undefined) {
  if (!code) return '-'
  return deptNameMap.value.get(code) || code
}

onMounted(async () => {
  if (!projectStore.currentProject || projectStore.currentProject.id !== projectId.value) {
    await projectStore.fetchProject(projectId.value)
  }
  await Promise.all([
    projectStore.fetchMembers(projectId.value),
    milestoneStore.fetchMilestones(projectId.value),
    fetchProposal(),
    fetchProjectEnvironments()
  ])
})

const project = computed(() => projectStore.currentProject)
const members = computed(() => {
  const raw = projectStore.currentProject?.members || []
  return raw.map(m => ({
    ...m,
    realName: m.realName || userNameMap.value.get(m.uid) || ''
  }))
})
const milestones = computed(() => milestoneStore.milestones)
const currentUserRole = computed(() => projectStore.currentProject?.currentUserRole)
const canManage = computed(() => currentUserRole.value === 'manager')

// 里程碑进度
const { overallProgress, overdueWarnings } = useMilestoneProgress({ projectId })

// 里程碑统计
const milestoneStats = computed(() => {
  const total = milestones.value.length
  const completed = milestones.value.filter(m => m.status === 'completed').length
  return { total, completed }
})

// 下一个截止的里程碑
const nextMilestone = computed(() => {
  const upcoming = milestones.value
    .filter(m => m.status !== 'completed' && m.endDate)
    .sort((a, b) => new Date(a.endDate!).getTime() - new Date(b.endDate!).getTime())
  return upcoming[0] || null
})

function formatDate(date: string | null) {
  if (!date) return '-'
  return date.slice(0, 10)
}

function formatShortDate(date: string | null) {
  if (!date) return '-'
  const d = new Date(date)
  const month = d.toLocaleString('zh-CN', { month: 'short' })
  return `${month}${d.getDate()}日`
}

// 里程碑状态标签
const milestoneStatusLabel: Record<string, string> = {
  planning: '计划中',
  todo: '待开始',
  active: '进行中',
  completed: '已完成'
}

const milestoneStatusColor: Record<string, string> = {
  planning: 'neutral',
  todo: 'secondary',
  active: 'primary',
  completed: 'success'
}

// const methodologyLabel: Record<string, string> = {
//   PIVR: '汇智PIVR'
// }

const categoryLabel: Record<string, string> = {
  product_dev: '产品研发',
  custom_dev: '定制开发',
  delivery: '交付实施',
  maintenance: '运维保障',
  sales: '销售机会',
  presales: '售前支持',
  improvement: '内部改善',
  compliance: '合规治理'
}

interface ProjectEnvironmentRow {
  id: number
  environment_code?: string
  delivery_asset_code?: string | null
  relation_type?: string
  delivery_status?: string
  is_primary?: boolean | number
  handover_status?: string
  delivery_version_snapshot?: string | null
  assets_sync_status?: string
  assets_sync_error?: string | null
}

const projectEnvironments = ref<ProjectEnvironmentRow[]>([])
const loadingProjectEnvironments = ref(false)
const showEnvironmentModal = ref(false)
const savingEnvironment = ref(false)
const syncingEnvironmentId = ref<number | null>(null)
const environmentForm = reactive({
  environmentCode: '',
  environmentName: '',
  environmentType: 'customer_prod',
  deliveryAssetCode: '',
  relationType: 'initial_delivery',
  deliveryStatus: 'planned',
  deliveryVersionSnapshot: '',
  isPrimary: false
})

const relationTypeOptions = [
  { label: '初次实施', value: 'initial_delivery' },
  { label: '升级', value: 'upgrade' },
  { label: '迁移', value: 'migration' },
  { label: '维护', value: 'maintenance' },
  { label: '下线', value: 'decommission' },
  { label: '验证', value: 'verification' },
  { label: '其他', value: 'other' }
]

const deliveryStatusOptions = [
  { label: '计划', value: 'planned' },
  { label: '准备', value: 'provisioning' },
  { label: '已部署', value: 'deployed' },
  { label: '上线', value: 'online' },
  { label: '验收', value: 'accepted' },
  { label: '已交接', value: 'handed_over' }
]

const environmentTypeOptions = [
  { label: '客户生产', value: 'customer_prod' },
  { label: '客户测试', value: 'customer_test' },
  { label: '预发', value: 'staging' },
  { label: '测试', value: 'test' },
  { label: '开发', value: 'dev' },
  { label: '内部生产', value: 'internal_prod' }
]

const relationTypeLabel: Record<string, string> = {
  initial_delivery: '初次实施',
  upgrade: '升级',
  migration: '迁移',
  maintenance: '维护',
  decommission: '下线',
  verification: '验证',
  other: '其他'
}

const deliveryStatusLabel: Record<string, string> = {
  planned: '计划',
  provisioning: '准备',
  deployed: '已部署',
  online: '上线',
  accepted: '验收',
  handed_over: '已交接',
  suspended: '暂停',
  cancelled: '取消'
}

const syncStatusColor: Record<string, string> = {
  pending: 'warning',
  synced: 'success',
  failed: 'error'
}

function resetEnvironmentForm() {
  environmentForm.environmentCode = ''
  environmentForm.environmentName = ''
  environmentForm.environmentType = 'customer_prod'
  environmentForm.deliveryAssetCode = ''
  environmentForm.relationType = 'initial_delivery'
  environmentForm.deliveryStatus = 'planned'
  environmentForm.deliveryVersionSnapshot = ''
  environmentForm.isPrimary = false
}

async function fetchProjectEnvironments() {
  loadingProjectEnvironments.value = true
  try {
    const res = await $fetch<{ code?: number, data?: { items?: ProjectEnvironmentRow[] }, items?: ProjectEnvironmentRow[] }>(
      `/api/v1/projects/${projectId.value}/environments`
    )
    const data = res.data || res
    projectEnvironments.value = Array.isArray(data.items) ? data.items : []
  } catch {
    projectEnvironments.value = []
  } finally {
    loadingProjectEnvironments.value = false
  }
}

async function saveProjectEnvironment() {
  if (!environmentForm.environmentCode.trim() && !environmentForm.environmentName.trim()) {
    toast.add({ title: '请填写环境名称或正式环境编码', color: 'warning' })
    return
  }
  savingEnvironment.value = true
  try {
    const res = await $fetch<{ code?: number, data?: { assetsSyncStatus?: string, assetsSyncError?: string } }>(`/api/v1/projects/${projectId.value}/environments/upsert`, {
      method: 'POST',
      body: {
        environmentCode: environmentForm.environmentCode.trim() || undefined,
        environmentName: environmentForm.environmentName.trim() || undefined,
        environmentType: environmentForm.environmentType,
        deliveryAssetCode: environmentForm.deliveryAssetCode.trim() || undefined,
        relationType: environmentForm.relationType,
        deliveryStatus: environmentForm.deliveryStatus,
        deliveryVersionSnapshot: environmentForm.deliveryVersionSnapshot.trim() || undefined,
        isPrimary: environmentForm.isPrimary
      }
    })
    const syncStatus = res.data?.assetsSyncStatus
    toast.add({
      title: syncStatus === 'failed' ? '项目环境已保存，Assets 同步失败' : '项目环境已保存',
      description: syncStatus === 'failed' ? res.data?.assetsSyncError : undefined,
      color: syncStatus === 'failed' ? 'warning' : 'success'
    })
    showEnvironmentModal.value = false
    resetEnvironmentForm()
    await fetchProjectEnvironments()
  } catch (err: unknown) {
    const message = err && typeof err === 'object' && 'message' in err ? String((err as { message?: unknown }).message || '') : ''
    toast.add({ title: message || '项目环境保存失败', color: 'error' })
  } finally {
    savingEnvironment.value = false
  }
}

async function retryProjectEnvironmentSync(env: ProjectEnvironmentRow) {
  if (!env.environment_code) return
  syncingEnvironmentId.value = env.id
  try {
    const res = await $fetch<{ code?: number, data?: { assetsSyncStatus?: string, assetsSyncError?: string } }>(`/api/v1/projects/${projectId.value}/environments/upsert`, {
      method: 'POST',
      body: {
        environmentCode: env.environment_code,
        deliveryAssetCode: env.delivery_asset_code || undefined,
        relationType: env.relation_type || 'initial_delivery',
        deliveryStatus: env.delivery_status || 'planned',
        deliveryVersionSnapshot: env.delivery_version_snapshot || undefined,
        isPrimary: Boolean(env.is_primary)
      }
    })
    toast.add({
      title: res.data?.assetsSyncStatus === 'failed' ? 'Assets 同步仍失败' : 'Assets 同步已完成',
      description: res.data?.assetsSyncStatus === 'failed' ? res.data?.assetsSyncError : undefined,
      color: res.data?.assetsSyncStatus === 'failed' ? 'warning' : 'success'
    })
    await fetchProjectEnvironments()
  } catch (err: unknown) {
    const message = err && typeof err === 'object' && 'message' in err ? String((err as { message?: unknown }).message || '') : ''
    toast.add({ title: message || 'Assets 同步重试失败', color: 'error' })
  } finally {
    syncingEnvironmentId.value = null
  }
}

function nextProjectEnvironmentStatus(status: string | undefined) {
  switch (status || 'planned') {
    case 'planned':
      return 'provisioning'
    case 'provisioning':
      return 'deployed'
    case 'deployed':
      return 'online'
    case 'online':
      return 'accepted'
    case 'accepted':
      return 'handed_over'
    default:
      return ''
  }
}

async function advanceProjectEnvironmentStatus(env: ProjectEnvironmentRow) {
  if (!env.environment_code) return
  const targetStatus = nextProjectEnvironmentStatus(env.delivery_status)
  if (!targetStatus) return
  syncingEnvironmentId.value = env.id
  try {
    const res = await $fetch<{ code?: number, data?: { assetsSyncStatus?: string, assetsSyncError?: string } }>(
      `/api/v1/projects/${projectId.value}/environments/${encodeURIComponent(env.environment_code)}:status`,
      {
        method: 'POST',
        body: {
          deliveryStatus: targetStatus,
          deliveryAssetCode: env.delivery_asset_code || undefined,
          relationType: env.relation_type || 'initial_delivery',
          deliveryVersionSnapshot: env.delivery_version_snapshot || undefined
        }
      }
    )
    toast.add({
      title: res.data?.assetsSyncStatus === 'failed' ? '状态已保存，Assets 同步失败' : `已推进到${deliveryStatusLabel[targetStatus] || targetStatus}`,
      description: res.data?.assetsSyncStatus === 'failed' ? res.data?.assetsSyncError : undefined,
      color: res.data?.assetsSyncStatus === 'failed' ? 'warning' : 'success'
    })
    await fetchProjectEnvironments()
  } catch (err: unknown) {
    const message = err && typeof err === 'object' && 'message' in err ? String((err as { message?: unknown }).message || '') : ''
    toast.add({ title: message || '环境状态推进失败', color: 'error' })
  } finally {
    syncingEnvironmentId.value = null
  }
}

// const approvalStatusLabel: Record<string, string> = {
//   not_required: '无需审批',
//   pending: '待审批',
//   approved: '已批准',
//   rejected: '已驳回'
// }

// const approvalStatusColor: Record<string, string> = {
//   not_required: 'neutral',
//   pending: 'warning',
//   approved: 'success',
//   rejected: 'error'
// }

// ========================
// 立项书
// ========================
interface ProposalInfo {
  id: number
  uuid: string
  title: string
  codocsUuid: string | null
  createdBy: string
  createdAt: string
}

const proposal = ref<ProposalInfo | null>(null)
const showProposalPreviewModal = ref(false)

async function fetchProposal() {
  try {
    const res = await $fetch<{ code: number, data: { proposal: ProposalInfo | null } }>(
      `/api/v1/projects/${projectId.value}/documents`
    )
    if (res.code === 0) {
      proposal.value = res.data.proposal
    }
  } catch {
    // 静默处理
  }
}

// ========================
// 审批模式
// ========================
const { isApprovalMode } = useApprovalMode()

// 发起立项审批
// ========================
const toast = useToast()
const showSubmitApprovalConfirm = ref(false)
const submittingApproval = ref(false)

// 立项审批校验
interface ApprovalCheckItem {
  type: 'error' | 'warning'
  message: string
}

const approvalChecks = ref<ApprovalCheckItem[]>([])
const hasApprovalErrors = computed(() => approvalChecks.value.some(c => c.type === 'error'))

async function handleSubmitApproval() {
  if (!project.value) return
  submittingApproval.value = true

  try {
    // 1. prepare: 匹配路由、获取表单
    const prepareRes = await prepareInstance({
      app_code: 'aims',
      resource_code: 'projects',
      action_code: 'initiation',
      biz_id: String(project.value.id),
      biz_title: project.value.shortName || project.value.name,
      biz_context: {
        dept_code: project.value.deptCode,
        category: project.value.category
      }
    })

    const prepareData = prepareRes.data as { action_def: { id: number }, matched_routes: Array<{ id: number }> } | null

    if (prepareRes.code !== 0 || !prepareData?.matched_routes?.length) {
      toast.add({ title: '未找到匹配的审批流程', color: 'error' })
      return
    }

    const { action_def, matched_routes } = prepareData
    const route = matched_routes[0]!

    // 2. create instance: 发起审批
    const createRes = await createInstance({
      action_def_id: action_def.id,
      route_id: route.id,
      biz_id: String(project.value.id),
      biz_title: project.value.shortName || project.value.name,
      biz_url: resolveCurrentAppUrl(`/projects/${project.value.id}`),
      biz_context: {
        dept_code: project.value.deptCode,
        category: project.value.category,
        leader_uid: project.value.leaderUid
      }
    })

    if (createRes.code === 0) {
      toast.add({
        title: createRes.data.mode === 'resubmitted' ? '已重新提交立项审批' : '立项审批已发起',
        color: 'success'
      })
      // 更新项目状态为审批中
      await projectStore.updateProject(projectId.value, { lifecycleStatus: 'approval_pending' })
      // 刷新项目数据
      await projectStore.fetchProject(projectId.value)
      showSubmitApprovalConfirm.value = false
    }
  } catch (err: unknown) {
    const objectError = err && typeof err === 'object'
      ? err as { data?: { message?: unknown }, message?: unknown }
      : null
    const msg = typeof objectError?.data?.message === 'string'
      ? objectError.data.message
      : typeof objectError?.message === 'string'
        ? objectError.message
        : '发起审批失败'
    toast.add({ title: msg, color: 'error' })
  } finally {
    submittingApproval.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="project-overview" :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }">
    <template #body>
      <div class="flex flex-col h-full min-h-0">
        <div
          v-if="projectStore.loading && !project"
          class="flex justify-center py-12"
        >
          <UIcon
            name="i-lucide-loader-2"
            class="w-8 h-8 animate-spin text-muted"
          />
        </div>

        <!-- 项目导航栏 -->
        <ProjectNavbar>
          <template
            v-if="project && canManage && !isApprovalMode"
            #actions
          >
            <!-- <UButton
              v-if="project.lifecycleStatus === 'draft'"
              icon="i-lucide-send"
              label="发起审批流程"
              color="primary"
              variant="soft"
              size="sm"
              @click="openSubmitApprovalConfirm"
            /> -->
          </template>
        </ProjectNavbar>

        <div
          v-if="project"
          class="flex-1 min-h-0 overflow-y-auto px-6 pt-4 pb-12 space-y-6"
        >
          <!-- ========== 统计卡片行 ========== -->
          <div class="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <!-- 项目进度 -->
            <UPageCard
              spotlight
              variant="outline"
              :ui="{ container: 'gap-y-2 sm:px-6 sm:py-4' }"
            >
              <div class="space-y-1">
                <p class="text-xs font-semibold tracking-widest uppercase text-muted">
                  整体进度
                </p>
                <div class="flex items-baseline gap-1">
                  <span class="text-2xl font-bold">{{ overallProgress }}%</span>
                  <span class="text-sm text-muted">完成</span>
                </div>
              </div>
            </UPageCard>

            <!-- 负责人 -->
            <UPageCard
              spotlight
              variant="outline"
              :ui="{ container: 'gap-y-2 sm:px-6 sm:py-4' }"
            >
              <div class="space-y-1">
                <p class="text-xs font-semibold tracking-widest uppercase text-muted">
                  项目负责人
                </p>
                <div class="flex items-center gap-2 mt-1">
                  <div class="size-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary">
                    {{ getUserName(project.leaderUid).slice(0, 1) }}
                  </div>
                  <span class="text-sm font-semibold">{{ getUserName(project.leaderUid) }}</span>
                </div>
              </div>
            </UPageCard>

            <!-- 里程碑统计 -->
            <UPageCard
              spotlight
              variant="outline"
              :ui="{ container: 'gap-y-2 sm:px-6 sm:py-4' }"
            >
              <div class="space-y-1">
                <p class="text-xs font-semibold tracking-widest uppercase text-muted">
                  里程碑
                </p>
                <div class="flex items-baseline gap-1">
                  <span class="text-2xl font-bold">
                    {{ milestoneStats.completed }}
                    /
                    {{ milestoneStats.total }}
                  </span>
                  <span class="text-sm text-muted">完成</span>
                </div>
              </div>
            </UPageCard>

            <!-- 下一交付 -->
            <UPageCard
              spotlight
              variant="outline"
              :ui="{ container: 'gap-y-2 sm:px-6 sm:py-4' }"
            >
              <div class="space-y-1">
                <p class="text-xs font-semibold tracking-widest uppercase text-muted">
                  下一交付
                </p>
                <div v-if="nextMilestone">
                  <span class="text-2xl font-bold text-primary">
                    {{ formatShortDate(nextMilestone.endDate) }}
                  </span>
                  <span class="text-sm text-muted">{{ nextMilestone.name }}</span>
                </div>
                <span
                  v-else
                  class="text-sm text-muted"
                >暂无</span>
              </div>
            </UPageCard>
          </div>

          <!-- ========== 主要内容区：里程碑时间线 + 侧边信息 ========== -->
          <div class="grid grid-cols-1 lg:grid-cols-[1fr_320px] xl:grid-cols-[1fr_400px] 2xl:grid-cols-[1fr_480px] gap-6">
            <!-- 左侧：里程碑时间线 -->
            <div class="space-y-0">
              <div
                v-if="milestones.length === 0"
                class="text-center py-12 text-muted"
              >
                <UIcon
                  name="i-lucide-milestone"
                  class="size-10 mx-auto mb-3"
                />
                <p>暂无里程碑</p>
                <UButton
                  v-if="canManage"
                  label="前往计划页创建"
                  color="primary"
                  variant="soft"
                  size="sm"
                  class="mt-3"
                  :to="`/projects/${projectId}/plan`"
                />
              </div>

              <div
                v-for="(ms, idx) in milestones"
                :key="ms.id"
                class="relative flex gap-5"
              >
                <!-- 时间线轴 -->
                <div class="flex flex-col items-center shrink-0 w-10">
                  <!-- 连接线（上） -->
                  <div
                    class="w-px flex-1"
                    :class="idx === 0 ? 'bg-transparent' : 'bg-border'"
                  />
                  <!-- 节点圆 -->
                  <div
                    class="shrink-0 size-10 rounded-xl flex items-center justify-center text-sm font-bold"
                    :class="{
                      'bg-secondary text-white': ms.status === 'todo',
                      'bg-primary text-white': ms.status === 'active',
                      'bg-success text-white': ms.status === 'completed',
                      'bg-elevated text-muted border border-default': ms.status === 'planning'
                    }"
                  >
                    {{ String(idx + 1).padStart(2, '0') }}
                  </div>
                  <!-- 连接线（下） -->
                  <div
                    class="w-px flex-1"
                    :class="idx === milestones.length - 1 ? 'bg-transparent' : 'bg-border'"
                  />
                </div>

                <!-- 里程碑内容卡片 -->
                <div
                  class="flex-1"
                  :class="{
                    'pt-0': idx === 0,
                    'pt-2': idx !== 0,
                    'pb-0': idx === milestones.length - 1,
                    'pb-2': idx !== milestones.length - 1
                  }"
                >
                  <UCard class="w-full">
                    <div class="space-y-3">
                      <!-- 标题行 -->
                      <div class="flex items-start justify-between gap-3">
                        <div>
                          <h3 class="text-base font-bold">
                            {{ ms.name }}
                          </h3>
                          <p
                            v-if="ms.endDate"
                            class="text-xs text-muted mt-0.5"
                          >
                            目标日期: {{ formatDate(ms.endDate) }}
                          </p>
                          <p v-else class="text-xs text-muted mt-0.5">
                            尚未设定里程碑日期
                          </p>
                        </div>
                        <div class="flex items-center gap-3 shrink-0">
                          <!-- 进度条 -->
                          <div
                            v-if="ms.status !== 'planning'"
                            class="flex items-center gap-2"
                          >
                            <div class="w-24 h-1.5 rounded-full bg-elevated overflow-hidden">
                              <div
                                class="h-full rounded-full transition-all"
                                :class="ms.status === 'completed' ? 'bg-success' : 'bg-primary'"
                                :style="{ width: `${ms.status === 'completed' ? 100 : (ms.progress ?? 50)}%` }"
                              />
                            </div>
                            <span class="text-xs font-medium text-muted">
                              {{ ms.status === 'completed' ? 100 : (ms.progress ?? 0) }}%
                            </span>
                          </div>
                          <UBadge
                            :color="(milestoneStatusColor[ms.status] as any)"
                            variant="subtle"
                            size="xs"
                          >
                            {{ milestoneStatusLabel[ms.status] || ms.status }}
                          </UBadge>
                        </div>
                      </div>

                      <!-- 描述 -->
                      <p
                        v-if="ms.description"
                        class="text-sm text-muted"
                      >
                        {{ ms.description }}
                      </p>

                      <!-- 交付物清单 -->
                      <div
                        v-if="ms.deliverables && ms.deliverables.length > 0"
                        class="space-y-1"
                      >
                        <div class="flex flex-wrap gap-2">
                          <div
                            v-for="(d, dIdx) in ms.deliverables"
                            :key="dIdx"
                            class="flex items-center gap-1.5 rounded-lg border border-default px-2.5 py-1.5 text-xs"
                          >
                            <UIcon
                              :name="d.completed ? 'i-lucide-check-circle' : 'i-lucide-circle'"
                              class="size-3.5"
                              :class="d.completed ? 'text-success' : 'text-muted'"
                            />
                            <span :class="d.completed ? 'line-through text-muted' : ''">
                              {{ d.name }}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </UCard>
                </div>
              </div>
            </div>

            <!-- 右侧：项目信息面板 -->
            <div class="space-y-4">
              <!-- 项目信息 -->
              <UCard>
                <template #header>
                  <div class="flex items-center gap-2">
                    <UIcon
                      name="i-lucide-info"
                      class="size-4 text-primary"
                    />
                    <span class="font-semibold text-sm">项目信息</span>
                  </div>
                </template>
                <div class="space-y-3 text-sm">
                  <div class="flex justify-between gap-3">
                    <span class="text-muted">分类</span>
                    <UBadge
                      color="info"
                      variant="subtle"
                      size="xs"
                    >
                      {{ categoryLabel[project.category] || project.category }}
                    </UBadge>
                  </div>
                  <div class="flex justify-between gap-3">
                    <span class="text-muted">开始日期</span>
                    <span>{{ formatDate(project.startDate) }}</span>
                  </div>
                  <div class="flex justify-between gap-3">
                    <span class="text-muted">结束日期</span>
                    <span>{{ formatDate(project.endDate) }}</span>
                  </div>
                  <!-- <div class="flex justify-between gap-3">
                    <span class="text-muted">审批状态</span>
                    <UBadge
                      :color="(approvalStatusColor[project.approvalStatus] as any)"
                      variant="subtle"
                      size="xs"
                    >
                      {{ approvalStatusLabel[project.approvalStatus] || project.approvalStatus }}
                    </UBadge>
                  </div> -->
                  <div class="flex justify-between gap-3">
                    <span class="text-muted">所属部门</span>
                    <span>{{ getDeptName(project.deptCode) }}</span>
                  </div>
                  <div class="flex justify-between items-center gap-3">
                    <span class="text-muted">立项书</span>
                    <button
                      v-if="proposal"
                      class="text-primary hover:underline truncate max-w-45 text-right cursor-pointer"
                      @click="showProposalPreviewModal = true"
                    >
                      {{ proposal.title }}
                    </button>
                    <span v-else class="text-warning">未提交</span>
                  </div>
                </div>
              </UCard>

              <!-- 交付环境 -->
              <UCard>
                <template #header>
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <UIcon
                        name="i-lucide-server-cog"
                        class="size-4 text-primary"
                      />
                      <span class="font-semibold text-sm">交付环境</span>
                      <UBadge
                        color="neutral"
                        variant="subtle"
                        size="xs"
                      >
                        {{ projectEnvironments.length }}
                      </UBadge>
                    </div>
                    <UButton
                      v-if="canManage"
                      icon="i-lucide-plus"
                      color="primary"
                      variant="soft"
                      size="xs"
                      @click="showEnvironmentModal = true"
                    />
                  </div>
                </template>

                <div
                  v-if="loadingProjectEnvironments"
                  class="py-4 text-center text-muted"
                >
                  <UIcon
                    name="i-lucide-loader-2"
                    class="size-5 animate-spin"
                  />
                </div>
                <div
                  v-else-if="projectEnvironments.length === 0"
                  class="text-center py-4 text-xs text-muted"
                >
                  暂无环境
                </div>
                <div
                  v-else
                  class="space-y-2"
                >
                  <div
                    v-for="env in projectEnvironments.slice(0, 4)"
                    :key="env.id"
                    class="rounded-md border border-default px-3 py-2 space-y-2"
                  >
                    <div class="flex items-start justify-between gap-2">
                      <div class="min-w-0">
                        <div class="flex items-center gap-1.5">
                          <span class="font-mono text-xs font-semibold truncate">{{ env.environment_code }}</span>
                          <UBadge
                            v-if="env.is_primary"
                            color="primary"
                            variant="subtle"
                            size="xs"
                          >
                            主
                          </UBadge>
                        </div>
                        <p
                          v-if="env.delivery_asset_code"
                          class="text-xs text-muted truncate mt-0.5"
                        >
                          {{ env.delivery_asset_code }}
                        </p>
                      </div>
                      <div class="flex items-center gap-1">
                        <UButton
                          v-if="canManage && nextProjectEnvironmentStatus(env.delivery_status)"
                          icon="i-lucide-arrow-up-right"
                          :label="deliveryStatusLabel[nextProjectEnvironmentStatus(env.delivery_status)]"
                          color="primary"
                          variant="soft"
                          size="xs"
                          :loading="syncingEnvironmentId === env.id"
                          :disabled="syncingEnvironmentId !== null && syncingEnvironmentId !== env.id"
                          @click="advanceProjectEnvironmentStatus(env)"
                        />
                        <UButton
                          v-if="canManage && env.assets_sync_status === 'failed'"
                          icon="i-lucide-refresh-cw"
                          color="warning"
                          variant="ghost"
                          size="xs"
                          :loading="syncingEnvironmentId === env.id"
                          :disabled="syncingEnvironmentId !== null && syncingEnvironmentId !== env.id"
                          @click="retryProjectEnvironmentSync(env)"
                        />
                        <UBadge
                          :color="(syncStatusColor[env.assets_sync_status || 'pending'] as any)"
                          variant="subtle"
                          size="xs"
                        >
                          {{ env.assets_sync_status || 'pending' }}
                        </UBadge>
                      </div>
                    </div>
                    <div class="flex flex-wrap gap-1.5">
                      <UBadge
                        color="info"
                        variant="subtle"
                        size="xs"
                      >
                        {{ relationTypeLabel[env.relation_type || 'other'] || env.relation_type }}
                      </UBadge>
                      <UBadge
                        color="neutral"
                        variant="subtle"
                        size="xs"
                      >
                        {{ deliveryStatusLabel[env.delivery_status || 'planned'] || env.delivery_status }}
                      </UBadge>
                      <UBadge
                        v-if="env.delivery_version_snapshot"
                        color="neutral"
                        variant="outline"
                        size="xs"
                      >
                        {{ env.delivery_version_snapshot }}
                      </UBadge>
                    </div>
                    <p
                      v-if="env.assets_sync_error"
                      class="text-xs text-error line-clamp-2"
                    >
                      {{ env.assets_sync_error }}
                    </p>
                  </div>
                </div>
              </UCard>

              <!-- 团队成员 -->
              <UCard>
                <template #header>
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2">
                      <UIcon
                        name="i-lucide-users"
                        class="size-4 text-primary"
                      />
                      <span class="font-semibold text-sm">团队成员</span>
                      <UBadge
                        color="neutral"
                        variant="subtle"
                        size="xs"
                      >
                        {{ members.length }}
                      </UBadge>
                    </div>
                    <UButton
                      icon="i-lucide-arrow-right"
                      color="neutral"
                      variant="ghost"
                      size="xs"
                      :to="`/projects/${projectId}/settings`"
                    />
                  </div>
                </template>
                <div
                  v-if="members.length === 0"
                  class="text-center py-4 text-xs text-muted"
                >
                  暂无成员
                </div>
                <div
                  v-else
                  class="space-y-2"
                >
                  <div
                    v-for="member in members.slice(0, 5)"
                    :key="member.id"
                    class="flex items-center gap-2.5"
                  >
                    <div class="size-7 rounded-full bg-primary/10 flex items-center justify-center text-xs font-semibold text-primary shrink-0">
                      {{ (member.realName || member.uid || '?').slice(0, 1) }}
                    </div>
                    <div class="flex-1 min-w-0">
                      <p class="text-sm font-medium truncate">
                        {{ member.realName || member.uid }}
                      </p>
                    </div>
                    <UBadge
                      :color="(PROJECT_ROLE_COLORS[member.role] as any)"
                      variant="subtle"
                      size="xs"
                    >
                      {{ PROJECT_ROLE_LABELS[member.role] || member.role }}
                    </UBadge>
                  </div>
                  <div
                    v-if="members.length > 5"
                    class="text-xs text-muted text-center pt-1"
                  >
                    还有 {{ members.length - 5 }} 位成员
                  </div>
                </div>
              </UCard>

              <!-- 逾期预警 -->
              <UCard v-if="overdueWarnings.length > 0">
                <template #header>
                  <div class="flex items-center gap-2">
                    <UIcon
                      name="i-lucide-alert-triangle"
                      class="size-4 text-warning"
                    />
                    <span class="font-semibold text-sm">风险预警</span>
                  </div>
                </template>
                <div class="space-y-2">
                  <div
                    v-for="w in overdueWarnings"
                    :key="w.id"
                    class="flex items-center justify-between gap-2"
                  >
                    <span class="text-sm truncate">{{ w.name }}</span>
                    <UBadge
                      color="error"
                      variant="subtle"
                      size="xs"
                    >
                      逾期 {{ w.daysOverdue }} 天
                    </UBadge>
                  </div>
                </div>
              </UCard>

              <!-- 业务信息 -->
              <UCard v-if="project.customerName || project.contractCode">
                <template #header>
                  <div class="flex items-center gap-2">
                    <UIcon
                      name="i-lucide-building"
                      class="size-4 text-primary"
                    />
                    <span class="font-semibold text-sm">业务信息</span>
                  </div>
                </template>
                <div class="space-y-3 text-sm">
                  <div
                    v-if="project.customerName"
                    class="flex justify-between gap-3"
                  >
                    <span class="text-muted">客户</span>
                    <span>{{ project.customerName }}</span>
                  </div>
                  <div
                    v-if="project.contractCode"
                    class="flex justify-between gap-3"
                  >
                    <span class="text-muted">合同</span>
                    <span class="font-mono">{{ project.contractCode }}</span>
                  </div>
                </div>
              </UCard>
            </div>
          </div>
        </div>
      </div>
    </template>
  </UDashboardPanel>

  <UModal
    v-model:open="showEnvironmentModal"
    title="关联交付环境"
  >
    <template #body>
      <div class="space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <UFormField label="环境名称">
            <UInput
              v-model="environmentForm.environmentName"
              class="w-full"
              placeholder="生产环境"
            />
          </UFormField>
          <UFormField label="已有环境编码">
            <UInput
              v-model="environmentForm.environmentCode"
              class="w-full"
              placeholder="ENV-..."
            />
          </UFormField>
          <UFormField label="环境类型">
            <USelect
              v-model="environmentForm.environmentType"
              :items="environmentTypeOptions"
              class="w-full"
            />
          </UFormField>
          <UFormField label="交付资产">
            <UInput
              v-model="environmentForm.deliveryAssetCode"
              class="w-full"
              placeholder="CDA-..."
            />
          </UFormField>
          <UFormField label="关系类型">
            <USelect
              v-model="environmentForm.relationType"
              :items="relationTypeOptions"
              class="w-full"
            />
          </UFormField>
          <UFormField label="交付状态">
            <USelect
              v-model="environmentForm.deliveryStatus"
              :items="deliveryStatusOptions"
              class="w-full"
            />
          </UFormField>
        </div>
        <UFormField label="版本快照">
          <UInput
            v-model="environmentForm.deliveryVersionSnapshot"
            class="w-full"
            placeholder="V1.0"
          />
        </UFormField>
        <UCheckbox
          v-model="environmentForm.isPrimary"
          label="设为本项目主环境"
        />
      </div>
    </template>
    <template #footer>
      <UButton
        color="neutral"
        variant="outline"
        :disabled="savingEnvironment"
        @click="showEnvironmentModal = false"
      >
        取消
      </UButton>
      <UButton
        color="primary"
        :loading="savingEnvironment"
        @click="saveProjectEnvironment"
      >
        保存
      </UButton>
    </template>
  </UModal>

  <UModal
    v-model:open="showSubmitApprovalConfirm"
    title="确认发起审批流程"
    description="发起申请后将无法对项目基本信息进行修改，确认后再发起。"
  >
    <template #body>
      <div class="space-y-3 px-1 text-sm text-muted">
        <p>
          项目：
          <span class="font-medium text-highlighted">{{ project?.shortName || project?.name || '-' }}</span>
        </p>
        <p>确认后项目将进入审批中状态，项目基本信息编辑入口会被锁定。</p>

        <!-- 校验结果 -->
        <div
          v-if="approvalChecks.length > 0"
          class="space-y-2 pt-2 border-t border-default"
        >
          <div
            v-for="(check, idx) in approvalChecks"
            :key="idx"
            class="flex items-start gap-2"
          >
            <UIcon
              :name="check.type === 'error' ? 'i-lucide-circle-x' : 'i-lucide-triangle-alert'"
              class="size-4 shrink-0 mt-0.5"
              :class="check.type === 'error' ? 'text-error' : 'text-warning'"
            />
            <span :class="check.type === 'error' ? 'text-error' : 'text-warning'">
              {{ check.message }}
            </span>
          </div>
        </div>
      </div>
    </template>
    <template #footer>
      <UButton
        color="neutral"
        variant="outline"
        :disabled="submittingApproval"
        @click="showSubmitApprovalConfirm = false"
      >
        取消
      </UButton>
      <UButton
        color="warning"
        icon="i-lucide-send"
        :loading="submittingApproval"
        :disabled="hasApprovalErrors"
        @click="handleSubmitApproval"
      >
        确认发起
      </UButton>
    </template>
  </UModal>

  <!-- ========== 立项书预览弹窗 ========== -->
  <UModal
    v-model:open="showProposalPreviewModal"
    :ui="{ content: 'sm:max-w-6xl', body: 'overflow-hidden p-0' }"
  >
    <template #header>
      <span class="text-base font-medium">{{ proposal?.title || '立项书预览' }}</span>
    </template>
    <template #body>
      <div class="h-[70vh] rounded-lg border border-default bg-elevated/40 p-4 min-h-48">
        <AimsDocumentPreview
          v-if="proposal?.codocsUuid && showProposalPreviewModal"
          :key="proposal.codocsUuid"
          source="codocs"
          :codocs-uuid="proposal.codocsUuid"
          :project-id="projectId"
          :title="proposal.title"
        />
        <div
          v-else
          class="flex items-center justify-center h-full text-sm text-muted"
        >
          该立项书暂无关联的 Codocs 文档
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end">
        <UButton
          label="关闭"
          color="neutral"
          variant="soft"
          @click="showProposalPreviewModal = false"
        />
      </div>
    </template>
  </UModal>
</template>
