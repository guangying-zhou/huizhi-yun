<script setup lang="ts">
import { useAimsModule } from '../../../../layer/useAimsModule'
import { PROJECT_ROLE_COLORS, PROJECT_ROLE_LABELS } from '../../../utils/projectRoles'
import { projectModuleEnabled } from '../../../utils/projectModuleConfig'
import { getProjectCategoryLabel } from '../../../config/project'
import { useMilestoneProgress } from '../../../composables/useMilestoneProgress'
import { useMilestoneStore } from '../../../stores/milestone'
import { useProjectStore } from '../../../stores/project'
import AimsDocumentPreview from '../../../components/AimsDocumentPreview.vue'
import ProjectEnvironmentPanel from '../../../components/project/ProjectEnvironmentPanel.vue'
import ProjectNavbar from '../../../components/project/ProjectNavbar.vue'


// 同一份代码供独立应用与企业宿主使用：非宿主模式下 moduleUrl 原样返回路径。
const { moduleUrl } = useAimsModule()
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
    fetchProposal()
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
const environmentsModuleEnabled = computed(() =>
  projectModuleEnabled(project.value?.moduleConfig, project.value?.category, 'environments')
)
const serviceDeskModuleEnabled = computed(() =>
  projectModuleEnabled(project.value?.moduleConfig, project.value?.category, 'service_desk')
)

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

function opportunityUrl(oppId: number) {
  return `/altoc/opportunities/${oppId}`
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
      moduleUrl(`/api/v1/projects/${projectId.value}/documents`)
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
      },
      form_data: {
        appCode: 'aims',
        resourceCode: 'projects',
        actionCode: 'initiation',
        projectId: project.value.id
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

          <ProjectServiceLineHistory
            v-if="project.category === 'maintenance' && project.serviceLineCode"
            :project="project"
          />
          <ProjectServiceHealthPanel
            v-if="project.category === 'maintenance'"
            :project-id="projectId"
          />
          <ProjectPeriodClosePanel
            v-if="project.category === 'maintenance'"
            :project-id="projectId"
            :milestones="milestones"
            :can-manage="canManage"
            @closed="milestoneStore.fetchMilestones(projectId)"
          />

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
                <p>{{ project.category === 'routine' ? '日常事务不使用里程碑，请在工作项页直接承接任务' : '暂无里程碑' }}</p>
                <UButton
                  v-if="canManage && project.category !== 'routine'"
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
                      {{ getProjectCategoryLabel(project.category) }}
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
                  <div v-if="project.oppId" class="flex items-center justify-between gap-3">
                    <span class="text-muted">项目来源</span>
                    <UButton
                      :to="opportunityUrl(project.oppId)"
                      external
                      target="_blank"
                      label="Altoc 商机"
                      icon="i-lucide-external-link"
                      color="primary"
                      variant="link"
                      size="xs"
                      class="p-0"
                    />
                  </div>
                  <div v-if="project.category !== 'routine'" class="flex justify-between items-center gap-3">
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

              <UCard v-if="project.category === 'delivery' || project.category === 'maintenance'">
                <template #header>
                  <div class="flex items-center gap-2">
                    <UIcon
                      :name="project.category === 'maintenance' ? 'i-lucide-headset' : 'i-lucide-package-check'"
                      class="size-4 text-primary"
                    />
                    <span class="font-semibold text-sm">
                      {{ project.category === 'maintenance' ? '运维快照' : '交付节点' }}
                    </span>
                  </div>
                </template>
                <div
                  v-if="project.category === 'delivery'"
                  class="space-y-3 text-sm"
                >
                  <div class="flex justify-between gap-3">
                    <span class="text-muted">环境跟踪</span>
                    <UBadge
                      :color="environmentsModuleEnabled ? 'success' : 'neutral'"
                      variant="subtle"
                      size="xs"
                    >
                      {{ environmentsModuleEnabled ? '已启用' : '未启用' }}
                    </UBadge>
                  </div>
                  <div class="flex justify-between gap-3">
                    <span class="text-muted">当前里程碑</span>
                    <span class="truncate text-right">{{ nextMilestone?.name || '暂无' }}</span>
                  </div>
                  <div class="flex justify-between gap-3">
                    <span class="text-muted">回款节点</span>
                    <span class="text-muted">待接入合同数据</span>
                  </div>
                </div>
                <div
                  v-else
                  class="space-y-3 text-sm"
                >
                  <div class="flex justify-between gap-3">
                    <span class="text-muted">工单跟踪</span>
                    <UBadge
                      :color="serviceDeskModuleEnabled ? 'success' : 'neutral'"
                      variant="subtle"
                      size="xs"
                    >
                      {{ serviceDeskModuleEnabled ? '已启用' : '未启用' }}
                    </UBadge>
                  </div>
                  <div class="flex justify-between gap-3">
                    <span class="text-muted">完成率</span>
                    <span class="text-muted">阶段三接入</span>
                  </div>
                  <div class="flex justify-between gap-3">
                    <span class="text-muted">平均处理时长</span>
                    <span class="text-muted">阶段三接入</span>
                  </div>
                  <div class="flex justify-between gap-3">
                    <span class="text-muted">SLA</span>
                    <span class="text-muted">待接入</span>
                  </div>
                </div>
              </UCard>

              <ProjectEnvironmentPanel
                v-if="environmentsModuleEnabled"
                :project-id="projectId"
                :can-manage="canManage"
                compact
              />

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
