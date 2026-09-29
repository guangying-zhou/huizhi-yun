<script setup lang="ts">
import { useAimsModule } from '../useAimsModule'
import { projectCategoryPresentation, projectStatusPresentation } from '../../app/utils/projectOverviewPresentation'
import { milestoneOverview, type OverviewMember } from '../../app/utils/projectOverviewSummary'
import { PROJECT_ROLE_LABELS } from '../../app/utils/projectRoles'
import { milestoneStatusConfig } from '../../app/config/milestone'
import { useMilestoneStore } from '../../app/stores/milestone'
import { useProjectStore } from '../../app/stores/project'
import ProjectNavbar from '../../app/components/project/ProjectNavbar.vue'

// The Host overview shares the project header (name, code, status and the
// project switcher) with every other project page; the sidebar keeps the
// object navigation, so this page carries no duplicate page-link buttons.
const objectContext = useProvidedEnterpriseProjectObjectContext()
if (!objectContext) throw new Error('企业项目详情缺少 Host 对象上下文')

type Project = Record<string, unknown> & { id: number, name?: string, projectCode?: string, project_code?: string }
type BadgeColor = 'neutral' | 'primary' | 'success' | 'info' | 'warning' | 'error' | 'secondary'
const route = useRoute()
const { moduleUrl } = useAimsModule()
const project = objectContext.project as Ref<Project | null>
const { flat: departments } = useAccountDepartments()
const { users: directoryUsers } = useAccountUsers()
const loading = objectContext.loading
const error = objectContext.error
const id = computed(() => String(route.params.id || ''))
const projectId = computed(() => Number(route.params.id))
const canEditProject = computed(() => Boolean(objectContext.model.value?.groups.some(group => group.items.some(item => item.path === '/edit'))))
const canCreateWorkItem = objectContext.canCreateWorkItem
const status = computed(() => projectStatusPresentation(project.value?.lifecycleStatus ?? project.value?.lifecycle_status))
const category = computed(() => projectCategoryPresentation(project.value?.category))
const departmentName = computed(() => {
  const code = value('deptCode', 'dept_code')
  if (code === '-') return code
  return departments.value.find(department => department.deptCode === code)?.name?.trim() || code
})
const leaderUid = computed(() => value('leaderUid', 'leader_uid'))

const milestoneStore = useMilestoneStore()
const projectStore = useProjectStore()
const milestonesLoading = ref(false)
const membersLoading = ref(false)
const members = ref<OverviewMember[]>([])
const overview = computed(() => milestoneOverview(milestoneStore.milestones))

async function loadOverview() {
  if (!Number.isSafeInteger(projectId.value) || projectId.value <= 0) return
  milestonesLoading.value = true
  membersLoading.value = true
  await Promise.allSettled([
    milestoneStore.fetchMilestones(projectId.value).finally(() => {
      milestonesLoading.value = false
    }),
    projectStore.fetchMembers(projectId.value).then((rows) => {
      members.value = (rows || []) as OverviewMember[]
    }).finally(() => {
      membersLoading.value = false
    })
  ])
}
watch(projectId, () => void loadOverview(), { immediate: true })

function value(...keys: string[]) {
  for (const key of keys) {
    const item = project.value?.[key]
    if (item !== undefined && item !== null && String(item).trim()) return String(item)
  }
  return '-'
}
function userName(uid: string) {
  if (!uid || uid === '-') return '-'
  return directoryUsers.value.find(item => item.uid === uid)?.realName?.trim() || uid
}
function milestoneBadge(statusCode: string) {
  const config = milestoneStatusConfig[statusCode]
  return { label: config?.label || statusCode, color: (config?.color || 'neutral') as BadgeColor }
}
function shortDate(value: string | null | undefined) {
  return value ? value.slice(0, 10) : '—'
}

async function refresh() {
  await Promise.all([objectContext.refresh(), loadOverview()])
}
</script>

<template>
  <UDashboardPanel
    id="enterprise-project-overview"
    :ui="{ root: 'relative flex flex-col min-w-0 h-full shrink-0', body: 'flex flex-col flex-1 min-h-0 p-0 overflow-hidden' }"
  >
    <template #body>
      <div class="flex h-full min-h-0 flex-col">
        <ProjectNavbar>
          <template #actions>
            <UButton
              v-if="canCreateWorkItem"
              :to="moduleUrl(`/projects/${id}/work-items/new`)"
              icon="i-lucide-plus"
              size="sm"
            >
              创建工作项
            </UButton>
            <UButton
              v-if="canEditProject"
              :to="moduleUrl(`/projects/${id}/edit`)"
              icon="i-lucide-pencil"
              color="neutral"
              variant="outline"
              size="sm"
            >
              编辑基本信息
            </UButton>
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
          <UAlert
            v-if="error"
            color="error"
            icon="i-lucide-circle-alert"
            title="无法读取项目"
            :description="error"
          />
          <USkeleton
            v-else-if="loading && !project"
            class="h-64 w-full"
          />

          <div
            v-else-if="project"
            class="space-y-6"
          >
            <div class="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <UPageCard
                variant="outline"
                :ui="{ container: 'gap-y-2 p-4 sm:px-6 sm:py-4' }"
              >
                <div class="space-y-1">
                  <p class="text-xs font-semibold tracking-widest text-muted">
                    整体进度
                  </p>
                  <USkeleton
                    v-if="milestonesLoading"
                    class="h-8 w-16"
                  />
                  <div
                    v-else
                    class="flex items-baseline gap-1"
                  >
                    <span class="text-2xl font-bold tabular-nums">{{ overview.progress }}%</span>
                    <span class="text-sm text-muted">按里程碑</span>
                  </div>
                </div>
              </UPageCard>
              <UPageCard
                variant="outline"
                :ui="{ container: 'gap-y-2 p-4 sm:px-6 sm:py-4' }"
              >
                <div class="space-y-1">
                  <p class="text-xs font-semibold tracking-widest text-muted">
                    项目负责人
                  </p>
                  <div class="mt-1 flex items-center gap-2">
                    <span class="flex size-7 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {{ userName(leaderUid).slice(0, 1) }}
                    </span>
                    <span class="truncate text-sm font-semibold">{{ userName(leaderUid) }}</span>
                  </div>
                </div>
              </UPageCard>
              <UPageCard
                variant="outline"
                :ui="{ container: 'gap-y-2 p-4 sm:px-6 sm:py-4' }"
              >
                <div class="space-y-1">
                  <p class="text-xs font-semibold tracking-widest text-muted">
                    里程碑
                  </p>
                  <USkeleton
                    v-if="milestonesLoading"
                    class="h-8 w-16"
                  />
                  <div
                    v-else
                    class="flex items-baseline gap-1"
                  >
                    <span class="text-2xl font-bold tabular-nums">{{ overview.completed }} / {{ overview.total }}</span>
                    <span class="text-sm text-muted">完成</span>
                  </div>
                </div>
              </UPageCard>
              <UPageCard
                variant="outline"
                :ui="{ container: 'gap-y-2 p-4 sm:px-6 sm:py-4' }"
              >
                <div class="space-y-1">
                  <p class="text-xs font-semibold tracking-widest text-muted">
                    下一交付
                  </p>
                  <USkeleton
                    v-if="milestonesLoading"
                    class="h-8 w-24"
                  />
                  <div v-else-if="overview.next">
                    <span
                      class="text-2xl font-bold tabular-nums"
                      :class="overview.next.overdue ? 'text-error' : 'text-primary'"
                    >{{ shortDate(overview.next.endDate).slice(5) }}</span>
                    <span class="ml-1 text-sm text-muted">{{ overview.next.name }}</span>
                  </div>
                  <span
                    v-else
                    class="text-sm text-muted"
                  >暂无</span>
                </div>
              </UPageCard>
            </div>

            <UAlert
              v-if="overview.overdue.length"
              color="warning"
              variant="subtle"
              icon="i-lucide-triangle-alert"
              :title="`${overview.overdue.length} 个里程碑已逾期`"
              :description="overview.overdue.map(item => item.name).join('、')"
            />

            <div class="grid grid-cols-1 gap-6 xl:grid-cols-3">
              <section
                aria-labelledby="project-overview-milestones"
                class="min-w-0 space-y-3 xl:col-span-2"
              >
                <div class="flex items-center justify-between">
                  <h2
                    id="project-overview-milestones"
                    class="text-base font-semibold text-highlighted"
                  >
                    里程碑
                  </h2>
                  <UButton
                    :to="moduleUrl(`/projects/${id}/plan`)"
                    variant="link"
                    color="secondary"
                    size="sm"
                    trailing-icon="i-lucide-arrow-right"
                    class="px-0"
                  >
                    项目计划
                  </UButton>
                </div>
                <div
                  v-if="milestonesLoading"
                  class="space-y-2"
                >
                  <USkeleton
                    v-for="n in 3"
                    :key="n"
                    class="h-20 w-full"
                  />
                </div>
                <UCard v-else-if="!overview.items.length">
                  <CommonEmptyState
                    icon="i-lucide-flag"
                    title="尚未设置里程碑"
                    description="在项目计划中添加里程碑后，这里会显示进度与下一交付。"
                  />
                </UCard>
                <ol
                  v-else
                  class="space-y-2"
                >
                  <li
                    v-for="milestone in overview.items"
                    :key="milestone.id"
                  >
                    <UCard :ui="{ body: 'p-4 sm:p-4' }">
                      <div class="flex flex-wrap items-start justify-between gap-3">
                        <div class="min-w-0 space-y-1">
                          <div class="flex flex-wrap items-center gap-2">
                            <h3 class="text-sm font-semibold text-highlighted">
                              {{ milestone.name }}
                            </h3>
                            <UBadge
                              :color="milestoneBadge(milestone.status).color"
                              variant="subtle"
                              size="sm"
                            >
                              {{ milestoneBadge(milestone.status).label }}
                            </UBadge>
                            <UBadge
                              v-if="milestone.overdue"
                              color="error"
                              variant="outline"
                              size="sm"
                            >
                              已逾期
                            </UBadge>
                          </div>
                          <p class="text-xs text-muted tabular-nums">
                            {{ shortDate(milestone.startDate) }} 至 {{ shortDate(milestone.endDate) }}
                          </p>
                        </div>
                        <span class="text-sm font-semibold tabular-nums">{{ milestone.progress }}%</span>
                      </div>
                      <UProgress
                        :model-value="milestone.progress"
                        size="xs"
                        :color="milestone.status === 'completed' ? 'success' : milestone.overdue ? 'error' : 'primary'"
                        class="mt-3"
                      />
                    </UCard>
                  </li>
                </ol>
              </section>

              <aside class="min-w-0 space-y-4">
                <UCard>
                  <template #header>
                    <h2 class="text-sm font-semibold text-highlighted">
                      项目信息
                    </h2>
                  </template>
                  <dl class="space-y-3 text-sm">
                    <div class="flex items-center justify-between gap-3">
                      <dt class="text-muted">
                        状态
                      </dt><dd>
                        <UBadge
                          :color="status.color"
                          variant="subtle"
                        >
                          {{ status.label }}
                        </UBadge>
                      </dd>
                    </div>
                    <div class="flex items-center justify-between gap-3">
                      <dt class="text-muted">
                        项目分类
                      </dt><dd>
                        <UBadge
                          :color="category.color"
                          variant="subtle"
                        >
                          {{ category.label }}
                        </UBadge>
                      </dd>
                    </div>
                    <div class="flex justify-between gap-3">
                      <dt class="text-muted">
                        所属部门
                      </dt><dd class="truncate font-medium">
                        {{ departmentName }}
                      </dd>
                    </div>
                    <div class="flex justify-between gap-3">
                      <dt class="text-muted">
                        开始日期
                      </dt><dd class="font-medium tabular-nums">
                        {{ value('startDate', 'start_date') }}
                      </dd>
                    </div>
                    <div class="flex justify-between gap-3">
                      <dt class="text-muted">
                        结束日期
                      </dt><dd class="font-medium tabular-nums">
                        {{ value('endDate', 'end_date') }}
                      </dd>
                    </div>
                  </dl>
                  <p
                    v-if="value('description') !== '-'"
                    class="mt-4 whitespace-pre-wrap border-t border-default pt-4 text-sm text-toned"
                  >
                    {{ value('description') }}
                  </p>
                </UCard>

                <UCard>
                  <template #header>
                    <div class="flex items-center justify-between">
                      <h2 class="text-sm font-semibold text-highlighted">
                        项目成员<span
                          v-if="members.length"
                          class="ml-1 font-normal text-muted"
                        >{{ members.length }}</span>
                      </h2>
                      <UButton
                        :to="moduleUrl(`/projects/${id}/members`)"
                        variant="link"
                        color="secondary"
                        size="xs"
                        class="px-0"
                      >
                        管理成员
                      </UButton>
                    </div>
                  </template>
                  <div
                    v-if="membersLoading"
                    class="space-y-2"
                  >
                    <USkeleton
                      v-for="n in 3"
                      :key="n"
                      class="h-7 w-full"
                    />
                  </div>
                  <p
                    v-else-if="!members.length"
                    class="text-sm text-muted"
                  >
                    暂无项目成员
                  </p>
                  <ul
                    v-else
                    class="space-y-2"
                  >
                    <li
                      v-for="member in members.slice(0, 8)"
                      :key="member.uid"
                      class="flex items-center justify-between gap-2 text-sm"
                    >
                      <span class="flex min-w-0 items-center gap-2">
                        <span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-elevated text-xs font-medium">
                          {{ (member.realName || userName(member.uid)).slice(0, 1) }}
                        </span>
                        <span class="truncate">{{ member.realName || userName(member.uid) }}</span>
                      </span>
                      <span class="shrink-0 text-xs text-muted">{{ PROJECT_ROLE_LABELS[member.role as keyof typeof PROJECT_ROLE_LABELS] || member.role }}</span>
                    </li>
                  </ul>
                  <p
                    v-if="members.length > 8"
                    class="mt-2 text-xs text-muted"
                  >
                    另有 {{ members.length - 8 }} 人
                  </p>
                </UCard>

                <EnterpriseProjectProducts
                  v-if="project.category === 'product_dev' && (project.lifecycleStatus ?? project.lifecycle_status) === 'active'"
                  :project-id="id"
                  :can-edit="canEditProject"
                />
              </aside>
            </div>
          </div>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
