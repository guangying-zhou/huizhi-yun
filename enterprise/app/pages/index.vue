<script setup lang="ts">
import {
  currentWeekRange,
  dueLabel,
  greetingFor,
  isOpenWorkItem,
  isoWeekNumber,
  projectLifecycleMeta,
  projectRoleLabel,
  relativeTime,
  sumEntryHours,
  workItemStatusMeta,
  workItemsForTab,
  type WorkbenchWorkItem,
  type WorkbenchWorkTab
} from '../utils/workbench'

definePageMeta({ alias: ['/enterprise'] })

type NavNode = { id: string, label: string, to?: string, icon?: string, children?: readonly NavNode[] }
type Entry = { id: string, label: string, to: string, icon: string }
type PendingTask = { task_id: number, instance_no: string, biz_title: string, action_name: string, node_name: string, created_at: string }
type WorkbenchProject = { id: number, projectCode: string, name: string, lifecycleStatus: string, currentUserRole?: string | null, endDate: string | null }

const NuxtLinkComponent = resolveComponent('NuxtLink')
const auth = useAuth()
const access = useEnterpriseNavigationAccess()
const uid = computed(() => String(auth.user?.value || ''))
const displayName = computed(() => auth.userRealname?.value || auth.userNickname?.value || uid.value)
const now = new Date()
const week = currentWeekRange(now)
const dateLine = `${new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(now)} · 第 ${isoWeekNumber(now)} 周`

// Authorized entries come from the same navigation snapshot as the sidebar;
// each widget below is shown only when its destination is authorized.
const entries = computed(() => {
  const result: Entry[] = []
  function visit(nodes: readonly NavNode[], icon: string) {
    for (const node of nodes) {
      if (node.to) result.push({ id: node.id, label: node.label, to: node.to, icon: node.icon || icon })
      if (node.children) visit(node.children, node.icon || icon)
    }
  }
  visit([...access.navigation.value.primary, ...access.navigation.value.auxiliary] as NavNode[], 'i-lucide-circle')
  return result
})
const entryById = computed(() => new Map(entries.value.map(entry => [entry.id, entry])))
const canSeeWork = computed(() => entryById.value.has('aims.delivery.execution.work-items'))
const canSeeProjects = computed(() => entryById.value.has('aims.delivery.project.projects'))
const canSeeTimesheet = computed(() => entryById.value.has('aims.delivery.execution.timesheet'))
const weeklyEntry = computed(() => entryById.value.get('aims.delivery.execution.weekly-reports') || entryById.value.get('codocs.workspace.self.journal'))
const quickEntries = computed(() => entries.value.slice(0, 9))
const navLoading = computed(() => !entries.value.length && ['idle', 'loading'].includes(access.status.value))

const { data: approvalData, status: approvalStatus, error: approvalError } = useFetch<{ code: number, data: { items: PendingTask[], nextPage: number | null } }>('/api/workflow-proxy/tasks/pending', {
  server: false, query: { page: 1 }
})
const approvalsAvailable = computed(() => !approvalError.value && approvalData.value?.code === 0)
const approvals = computed(() => approvalsAvailable.value ? approvalData.value!.data.items : [])
const approvalCount = computed(() => approvalData.value?.data?.nextPage ? `${approvals.value.length}+` : String(approvals.value.length))

const { data: workData, status: workStatus, error: workError, execute: loadWork } = useFetch<{ code: number, data: { items: WorkbenchWorkItem[] } }>('/aims/api/v1/my-work-items', {
  server: false, immediate: false, query: computed(() => ({ filter: 'assigned', uid: uid.value }))
})
const workItems = computed(() => workData.value?.code === 0 ? workData.value.data.items : [])
const openWorkCount = computed(() => workItems.value.filter(isOpenWorkItem).length)
const workTab = ref<WorkbenchWorkTab>('active')
const workTabs = computed(() => ([
  { value: 'active', label: `进行中 ${workItemsForTab(workItems.value, 'active', now).length}` },
  { value: 'dueThisWeek', label: `本周到期 ${workItemsForTab(workItems.value, 'dueThisWeek', now).length}` },
  { value: 'inReview', label: `确认中 ${workItemsForTab(workItems.value, 'inReview', now).length}` }
]))
const visibleWork = computed(() => workItemsForTab(workItems.value, workTab.value, now).slice(0, 6))

const { data: projectData, status: projectStatus, error: projectError, execute: loadProjects } = useFetch<{ code: number, data: { items: WorkbenchProject[], total: number } }>('/aims/api/v1/projects', {
  server: false, immediate: false, query: { participatingOnly: 'true', page: '1', pageSize: '6' }
})
const projects = computed(() => projectData.value?.code === 0 ? projectData.value.data.items.slice(0, 6) : [])
const projectTotal = computed(() => projectData.value?.code === 0 ? projectData.value.data.total : 0)

const { data: hourData, status: hourStatus, execute: loadHours } = useFetch<{ code: number, data: unknown }>(() => `/aims/api/v1/users/${encodeURIComponent(uid.value)}/time-entries`, {
  server: false, immediate: false, query: { startDate: week.startDate, endDate: week.endDate, pageSize: '500' }
})
const weekHours = computed(() => hourData.value?.code === 0 ? sumEntryHours(hourData.value.data) : null)

const notifications = useNotifications()
const recentNotifications = computed(() => notifications.items.value.slice(0, 5))

// Each read starts only once the user and its authorized destination are
// known, so a user without Aims access never triggers a denied request.
watch([uid, canSeeWork], ([user, allowed]) => {
  if (user && allowed && workStatus.value === 'idle') void loadWork()
}, { immediate: true })
watch(canSeeProjects, (allowed) => {
  if (allowed && projectStatus.value === 'idle') void loadProjects()
}, { immediate: true })
watch([uid, canSeeTimesheet], ([user, allowed]) => {
  if (user && allowed && hourStatus.value === 'idle') void loadHours()
}, { immediate: true })
onMounted(() => {
  void notifications.loadSummary()
  void notifications.loadNotifications({ limit: 5 })
})

const summaryParts = computed(() => {
  const parts: string[] = []
  if (approvalsAvailable.value) parts.push(`${approvalCount.value} 条待审批`)
  if (canSeeWork.value && workStatus.value === 'success') parts.push(`${openWorkCount.value} 项未完成的工作`)
  if (canSeeTimesheet.value && weekHours.value !== null) parts.push(`本周已填 ${weekHours.value} 小时工时`)
  return parts
})

const kpis = computed(() => {
  const cards: { label: string, value: string, unit: string, hint: string, to?: string, loading: boolean }[] = []
  cards.push({ label: '待我审批', value: approvalCount.value, unit: '条', hint: approvals.value[0] ? `最早一条 ${relativeTime(approvals.value[approvals.value.length - 1]?.created_at, now)}` : '暂无待办', to: '/enterprise/approvals', loading: approvalStatus.value === 'pending' })
  if (canSeeWork.value) cards.push({ label: '未完成工作', value: String(openWorkCount.value), unit: '项', hint: `其中 ${workItemsForTab(workItems.value, 'dueThisWeek', now).length} 项本周到期`, to: entryById.value.get('aims.delivery.execution.work-items')?.to, loading: workStatus.value === 'pending' })
  if (canSeeTimesheet.value) cards.push({ label: '本周工时', value: weekHours.value === null ? '—' : String(weekHours.value), unit: '小时', hint: `${week.startDate.slice(5)} 至 ${week.endDate.slice(5)}`, to: entryById.value.get('aims.delivery.execution.timesheet')?.to, loading: hourStatus.value === 'pending' })
  cards.push({ label: '未读通知', value: String(notifications.summary.value.unreadCount), unit: '条', hint: '点击右上角铃铛查看', loading: notifications.summaryLoading.value })
  return cards
})
</script>

<template>
  <div class="mx-auto flex w-full max-w-[1600px] flex-col gap-5 p-4 sm:p-6">
    <header class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div class="min-w-0 space-y-1">
        <p class="text-xs text-muted">
          {{ dateLine }}
        </p>
        <h1 class="text-xl font-semibold text-highlighted">
          {{ greetingFor(now) }}<template v-if="displayName">
            ，{{ displayName }}
          </template>
        </h1>
        <p
          v-if="summaryParts.length"
          class="text-sm text-toned"
        >
          你有 {{ summaryParts.join('、') }}。
        </p>
      </div>
      <div class="grid grid-cols-2 gap-2 sm:flex">
        <UButton
          v-if="weeklyEntry"
          :to="weeklyEntry.to"
          color="neutral"
          variant="outline"
          icon="i-lucide-notebook-pen"
          class="justify-center"
        >
          写周报
        </UButton>
        <UButton
          v-if="canSeeTimesheet"
          :to="entryById.get('aims.delivery.execution.timesheet')?.to"
          icon="i-lucide-clock"
          class="justify-center"
        >
          记工时
        </UButton>
      </div>
    </header>

    <section
      aria-label="工作概览"
      class="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4"
    >
      <component
        :is="card.to ? NuxtLinkComponent : 'div'"
        v-for="card in kpis"
        :key="card.label"
        :to="card.to"
        class="flex flex-col gap-2 rounded-lg border border-default bg-default p-3 transition-colors sm:p-4"
        :class="card.to ? 'hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ui-secondary)' : ''"
      >
        <span class="text-xs font-medium text-toned sm:text-sm">{{ card.label }}</span>
        <USkeleton
          v-if="card.loading"
          class="h-8 w-16"
        />
        <span
          v-else
          class="flex items-baseline gap-1.5"
        >
          <span class="text-2xl font-semibold tabular-nums text-highlighted sm:text-3xl">{{ card.value }}</span>
          <span class="text-xs text-muted">{{ card.unit }}</span>
        </span>
        <span class="hidden text-xs text-muted sm:block">{{ card.hint }}</span>
      </component>
    </section>

    <div class="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <div class="flex min-w-0 flex-col gap-5 xl:col-span-2">
        <section
          v-if="canSeeWork"
          aria-labelledby="workbench-mywork"
          class="rounded-lg border border-default bg-default"
        >
          <div class="flex flex-col gap-3 border-b border-default px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <h2
              id="workbench-mywork"
              class="text-[15px] font-semibold text-highlighted"
            >
              我的工作
            </h2>
            <UTabs
              v-model="workTab"
              :items="workTabs"
              :content="false"
              size="sm"
              color="neutral"
              aria-label="工作筛选"
            />
          </div>
          <div
            v-if="workStatus === 'pending' || workStatus === 'idle'"
            class="space-y-2 p-4"
          >
            <USkeleton
              v-for="n in 4"
              :key="n"
              class="h-9 w-full"
            />
          </div>
          <UAlert
            v-else-if="workError || workData?.code !== 0"
            class="m-4"
            color="error"
            variant="subtle"
            title="工作项读取失败"
            description="请稍后刷新页面。"
          />
          <CommonEmptyState
            v-else-if="!visibleWork.length"
            icon="i-lucide-circle-check"
            title="这里没有需要处理的工作"
            description="分配给你的工作项会出现在这里。"
          />
          <ul v-else>
            <li
              v-for="item in visibleWork"
              :key="item.id"
              class="border-b border-muted last:border-b-0"
            >
              <NuxtLink
                :to="`/aims/projects/${item.projectId}/board/${item.id}/execution`"
                class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-elevated focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--ui-secondary) md:grid-cols-[88px_minmax(0,1fr)_160px_84px_72px]"
              >
                <span class="hidden font-mono text-xs text-muted md:block">{{ item.itemKey }}</span>
                <span class="truncate text-sm text-highlighted">{{ item.title }}</span>
                <span class="hidden truncate text-sm text-toned md:block">{{ item.projectName }}</span>
                <UBadge
                  :color="workItemStatusMeta[item.status]?.color || 'neutral'"
                  variant="outline"
                  size="sm"
                  class="justify-self-end md:justify-self-start"
                >
                  {{ workItemStatusMeta[item.status]?.label || item.status }}
                </UBadge>
                <span
                  class="col-span-2 text-xs tabular-nums md:col-span-1 md:text-right"
                  :class="dueLabel(item.dueDate, now).overdue ? 'text-error' : 'text-muted'"
                >
                  <span class="md:hidden">{{ item.itemKey }} · {{ item.projectName }} · 截止 </span>{{ dueLabel(item.dueDate, now).text }}
                </span>
              </NuxtLink>
            </li>
          </ul>
          <div class="border-t border-default px-4 py-2.5">
            <UButton
              :to="entryById.get('aims.delivery.execution.work-items')?.to"
              variant="link"
              color="secondary"
              size="sm"
              trailing-icon="i-lucide-arrow-right"
              class="px-0"
            >
              查看全部工作项
            </UButton>
          </div>
        </section>

        <section
          v-if="canSeeProjects"
          aria-labelledby="workbench-projects"
          class="flex flex-col gap-3"
        >
          <div class="flex items-center justify-between">
            <h2
              id="workbench-projects"
              class="text-[15px] font-semibold text-highlighted"
            >
              我参与的项目<span
                v-if="projectTotal"
                class="ml-1.5 text-xs font-normal text-muted"
              >共 {{ projectTotal }} 个</span>
            </h2>
            <UButton
              :to="entryById.get('aims.delivery.project.projects')?.to"
              variant="link"
              color="secondary"
              size="sm"
              class="px-0"
            >
              项目总览
            </UButton>
          </div>
          <div
            v-if="projectStatus === 'pending' || projectStatus === 'idle'"
            class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            <USkeleton
              v-for="n in 3"
              :key="n"
              class="h-28 w-full"
            />
          </div>
          <UAlert
            v-else-if="projectError || projectData?.code !== 0"
            color="error"
            variant="subtle"
            title="项目读取失败"
            description="请稍后刷新页面。"
          />
          <div
            v-else-if="!projects.length"
            class="rounded-lg border border-default"
          >
            <CommonEmptyState
              icon="i-lucide-folder-kanban"
              title="你还没有参与的项目"
              description="加入项目后，项目会出现在这里。"
            />
          </div>
          <div
            v-else
            class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            <NuxtLink
              v-for="project in projects"
              :key="project.id"
              :to="`/aims/projects/${project.id}`"
              class="flex flex-col gap-3 rounded-lg border border-default bg-default p-4 hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ui-secondary)"
            >
              <span class="min-w-0">
                <span class="block truncate text-sm font-semibold text-highlighted">{{ project.name }}</span>
                <span class="block truncate font-mono text-xs text-muted">{{ project.projectCode }}<template v-if="project.currentUserRole"> · {{ projectRoleLabel[project.currentUserRole] || project.currentUserRole }}</template></span>
              </span>
              <span class="flex items-center justify-between gap-2">
                <UBadge
                  :color="projectLifecycleMeta[project.lifecycleStatus]?.color || 'neutral'"
                  variant="subtle"
                  size="sm"
                >
                  {{ projectLifecycleMeta[project.lifecycleStatus]?.label || project.lifecycleStatus }}
                </UBadge>
                <span
                  v-if="project.endDate"
                  class="text-xs text-muted"
                >计划结束 {{ project.endDate.slice(0, 10) }}</span>
              </span>
            </NuxtLink>
          </div>
        </section>

        <div
          v-if="!canSeeWork && !canSeeProjects && !navLoading"
          class="rounded-lg border border-default"
        >
          <CommonEmptyState
            icon="i-lucide-layout-dashboard"
            title="暂无可展示的工作内容"
            description="你的账号暂未开通项目与工作项权限，可从右侧常用入口或侧栏开始。"
          />
        </div>
      </div>

      <div class="flex min-w-0 flex-col gap-5">
        <section
          v-if="approvalsAvailable || approvalStatus === 'pending'"
          aria-labelledby="workbench-approvals"
          class="rounded-lg border border-default bg-default"
        >
          <div class="flex items-center justify-between border-b border-default px-4 py-3">
            <h2
              id="workbench-approvals"
              class="flex items-center gap-2 text-[15px] font-semibold text-highlighted"
            >
              待我审批
              <UBadge
                v-if="approvals.length"
                color="primary"
                variant="soft"
                size="sm"
              >
                {{ approvalCount }}
              </UBadge>
            </h2>
            <UButton
              to="/enterprise/approvals"
              variant="link"
              color="secondary"
              size="sm"
              class="px-0"
            >
              全部
            </UButton>
          </div>
          <div
            v-if="approvalStatus === 'pending'"
            class="space-y-2 p-4"
          >
            <USkeleton
              v-for="n in 2"
              :key="n"
              class="h-14 w-full"
            />
          </div>
          <CommonEmptyState
            v-else-if="!approvals.length"
            icon="i-lucide-inbox"
            title="没有待你审批的事项"
          />
          <ul v-else>
            <li
              v-for="task in approvals.slice(0, 4)"
              :key="task.task_id"
              class="border-b border-muted last:border-b-0"
            >
              <NuxtLink
                :to="`/enterprise/approvals/${task.task_id}`"
                class="flex flex-col gap-1 px-4 py-3 hover:bg-elevated focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--ui-secondary)"
              >
                <span class="flex items-start justify-between gap-2">
                  <span class="text-sm font-medium text-highlighted">{{ task.biz_title || '审批事项' }}</span>
                  <span class="shrink-0 text-xs text-muted">{{ relativeTime(task.created_at, now) }}</span>
                </span>
                <span class="text-xs text-muted">{{ task.action_name || '审批' }} · {{ task.node_name || '审批节点' }}</span>
              </NuxtLink>
            </li>
          </ul>
        </section>

        <section
          aria-labelledby="workbench-notifications"
          class="rounded-lg border border-default bg-default"
        >
          <div class="flex items-center justify-between border-b border-default px-4 py-3">
            <h2
              id="workbench-notifications"
              class="text-[15px] font-semibold text-highlighted"
            >
              最新通知
            </h2>
            <span
              v-if="notifications.summary.value.unreadCount"
              class="text-xs text-muted"
            >{{ notifications.summary.value.unreadCount }} 条未读</span>
          </div>
          <div
            v-if="notifications.loading.value && !recentNotifications.length"
            class="space-y-2 p-4"
          >
            <USkeleton
              v-for="n in 3"
              :key="n"
              class="h-10 w-full"
            />
          </div>
          <CommonEmptyState
            v-else-if="!recentNotifications.length"
            icon="i-lucide-bell"
            title="暂无通知"
          />
          <ul v-else>
            <li
              v-for="item in recentNotifications"
              :key="item.notificationId"
              class="flex gap-2.5 border-b border-muted px-4 py-2.5 last:border-b-0"
            >
              <span
                class="mt-1.5 size-2 shrink-0 rounded-full"
                :class="item.recipient.isRead ? 'bg-(--ui-border)' : 'bg-primary'"
              />
              <span class="min-w-0">
                <span class="block truncate text-sm text-highlighted">{{ item.displayLabel }}</span>
                <span class="text-xs text-muted">{{ item.recipient.isRead ? '已读' : '未读' }} · {{ relativeTime(item.createdAt, now) }}</span>
              </span>
            </li>
          </ul>
        </section>

        <section
          aria-labelledby="workbench-quick"
          class="flex flex-col gap-3"
        >
          <h2
            id="workbench-quick"
            class="text-[15px] font-semibold text-highlighted"
          >
            常用入口
          </h2>
          <div
            v-if="navLoading"
            class="grid grid-cols-3 gap-2"
          >
            <USkeleton
              v-for="n in 6"
              :key="n"
              class="h-20 w-full"
            />
          </div>
          <p
            v-else-if="!quickEntries.length"
            class="text-sm text-muted"
          >
            {{ ['error', 'expired'].includes(access.status.value) ? '导航权限暂不可用，请从侧栏重试。' : '暂无已授权入口，请联系管理员确认权限。' }}
          </p>
          <div
            v-else
            class="grid grid-cols-3 gap-2"
          >
            <NuxtLink
              v-for="entry in quickEntries"
              :key="entry.id"
              :to="entry.to"
              class="flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-lg bg-elevated px-1 py-3 text-center text-[13px] text-toned hover:bg-accented focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ui-secondary)"
            >
              <span class="flex size-8 items-center justify-center rounded-md border border-default bg-default">
                <UIcon
                  :name="entry.icon"
                  class="size-4 text-primary"
                />
              </span>
              {{ entry.label }}
            </NuxtLink>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
