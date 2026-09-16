<script setup lang="ts">
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('工作台')

const { userRealname, userDepartment } = useAuth()
const { apps, loading, loadApps } = useUserApplications()
const { summary: notificationSummary, loadSummary: loadNotificationSummary } = useNotifications()
const todoSummary = ref({ totalPending: 0, approvalPending: 0, followUpPending: 0 })
const todoSummaryLoading = ref(false)
const todoSummaryError = ref(false)
const greeting = ref('你好')

interface ApiResponse<T> {
  code: number
  data: T
}

interface CurrentDirectoryProfile {
  uid: string
  displayName: string
  realName: string
  deptName: string | null
}

const { data: currentDirectoryData } = await useFetch<ApiResponse<CurrentDirectoryProfile>>(
  '/api/directory/me',
  {
    default: () => ({
      code: 0,
      data: {
        uid: '',
        displayName: '',
        realName: '',
        deptName: null
      }
    })
  }
)
const currentDirectoryProfile = computed(() => currentDirectoryData.value?.data)
const workspaceRealName = computed(() => {
  return currentDirectoryProfile.value?.realName
    || currentDirectoryProfile.value?.displayName
    || userRealname.value
    || '朋友'
})
const workspaceDepartment = computed(() => {
  return currentDirectoryProfile.value?.deptName || userDepartment.value || '汇智云'
})

function updateGreeting() {
  const hour = new Date().getHours()
  if (hour >= 5 && hour < 12) {
    greeting.value = '早上好'
  } else if (hour >= 12 && hour < 18) {
    greeting.value = '下午好'
  } else {
    greeting.value = '晚上好'
  }
}

async function loadTodoSummary() {
  todoSummaryLoading.value = true
  todoSummaryError.value = false
  try {
    const response = await $fetch<{ data: typeof todoSummary.value }>('/api/v1/console/notifications/todos/summary')
    todoSummary.value = response.data || { totalPending: 0, approvalPending: 0, followUpPending: 0 }
  } catch {
    todoSummaryError.value = true
  } finally {
    todoSummaryLoading.value = false
  }
}

onMounted(() => {
  updateGreeting()
  loadApps()
  loadNotificationSummary()
  loadTodoSummary()
})

const visibleApps = computed(() => {
  return apps.value.filter(app => app.appCode !== 'console' && app.homeUrl)
})

const quickEntries = computed(() => [
  {
    label: '我的待办',
    value: String(todoSummary.value.totalPending),
    icon: 'i-lucide-clipboard-check',
    color: 'primary' as const,
    to: '/todos'
  },
  {
    label: '通知公告',
    value: String(notificationSummary.value.unreadCount || 0),
    icon: 'i-lucide-bell',
    color: 'info' as const,
    to: '/todos?todoKind=follow_up'
  },
  {
    label: '最近访问',
    value: visibleApps.value.length ? String(Math.min(visibleApps.value.length, 4)) : '0',
    icon: 'i-lucide-history',
    color: 'neutral' as const,
    to: '/'
  },
  {
    label: '轻量事项',
    value: String(todoSummary.value.followUpPending),
    icon: 'i-lucide-list-checks',
    color: 'warning' as const,
    to: '/'
  }
])

const commonLinks = [
  {
    label: '个人资料',
    icon: 'i-lucide-user-round',
    to: '/profile'
  },
  {
    label: '企业目录',
    icon: 'i-lucide-network',
    to: '/directory/users'
  },
  {
    label: '审批中心',
    icon: 'i-lucide-clipboard-check',
    to: '/approval/tasks'
  }
]
</script>

<template>
  <UDashboardPanel id="workspace" :ui="dashboardPanelUi">
    <template #body>
      <div class="mx-auto flex w-full max-w-7xl flex-col gap-4">
        <section class="flex flex-col gap-3 border-b border-default pb-4 md:flex-row md:items-end md:justify-between">
          <div class="min-w-0">
            <p class="text-sm text-muted">
              {{ workspaceDepartment }}
            </p>
            <h2 class="mt-1 truncate text-2xl font-semibold text-highlighted">
              {{ greeting }}，{{ workspaceRealName }}
            </h2>
          </div>
          <div class="flex flex-wrap gap-2">
            <UButton
              v-for="link in commonLinks"
              :key="link.label"
              :label="link.label"
              :icon="link.icon"
              :to="link.to"
              color="neutral"
              variant="outline"
              size="sm"
            />
          </div>
        </section>

        <section class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <NuxtLink
            v-for="entry in quickEntries"
            :key="entry.label"
            :to="entry.to"
            class="block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <UCard :ui="{ body: 'flex items-center justify-between gap-3' }" class="h-full transition-colors hover:bg-elevated">
              <div class="flex min-w-0 items-center gap-3">
                <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-elevated">
                  <UIcon :name="entry.icon" class="size-5 text-muted" />
                </div>
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium">
                    {{ entry.label }}
                  </p>
                  <p class="text-xs text-muted">
                    今日
                  </p>
                </div>
              </div>
              <UBadge :color="entry.color" variant="soft" size="lg">
                {{ entry.value }}
              </UBadge>
            </UCard>
          </NuxtLink>
        </section>

        <section class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <UCard>
            <template #header>
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0">
                  <h3 class="truncate text-base font-semibold">
                    我的应用
                  </h3>
                </div>
                <UIcon
                  v-if="loading"
                  name="i-lucide-loader-2"
                  class="size-4 animate-spin text-dimmed"
                />
              </div>
            </template>

            <div v-if="visibleApps.length" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <NuxtLink
                v-for="app in visibleApps"
                :key="app.appCode"
                :to="app.homeUrl || '/'"
                external
                class="group flex min-h-24 items-start gap-3 rounded-md border border-default p-3 transition-colors hover:bg-elevated"
              >
                <div class="flex size-10 shrink-0 items-center justify-center rounded-md bg-elevated">
                  <UIcon
                    v-if="isApplicationIconName(app.icon)"
                    :name="app.icon!"
                    class="size-5 text-muted"
                  />
                  <img
                    v-else-if="app.icon"
                    :src="app.icon"
                    :alt="app.appName"
                    class="size-5 rounded object-contain"
                  >
                  <UIcon v-else name="i-lucide-box" class="size-5 text-muted" />
                </div>
                <div class="min-w-0">
                  <p class="truncate text-sm font-semibold group-hover:text-primary">
                    {{ app.appName }}
                  </p>
                  <p class="mt-1 line-clamp-2 text-xs text-muted">
                    {{ app.description || app.appCode }}
                  </p>
                </div>
              </NuxtLink>
            </div>

            <div v-else class="flex min-h-32 items-center justify-center rounded-md border border-dashed border-default p-6 text-sm text-muted">
              暂无可访问应用
            </div>
          </UCard>

          <div class="flex flex-col gap-4">
            <UCard>
              <template #header>
                <h3 class="text-base font-semibold">
                  待办摘要
                </h3>
              </template>
              <div class="space-y-3">
                <div v-if="todoSummaryLoading" class="flex min-h-16 items-center justify-center">
                  <UIcon name="i-lucide-loader-2" class="size-5 animate-spin text-dimmed" />
                </div>
                <div v-else-if="todoSummaryError" class="rounded-md border border-error/30 bg-error/5 p-3">
                  <p class="text-sm text-error">
                    待办摘要加载失败
                  </p>
                  <UButton
                    class="mt-2"
                    label="重试"
                    size="xs"
                    color="error"
                    variant="ghost"
                    @click="loadTodoSummary"
                  />
                </div>
                <template v-else>
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-sm text-muted">审批待处理</span>
                    <UBadge color="primary" variant="soft">
                      {{ todoSummary.approvalPending }}
                    </UBadge>
                  </div>
                  <div class="flex items-center justify-between gap-3">
                    <span class="text-sm text-muted">事项待跟进</span>
                    <UBadge color="warning" variant="soft">
                      {{ todoSummary.followUpPending }}
                    </UBadge>
                  </div>
                </template>
              </div>
            </UCard>

            <UCard>
              <template #header>
                <h3 class="text-base font-semibold">
                  通知公告
                </h3>
              </template>
              <div v-if="notificationSummary.latest.length" class="space-y-3">
                <div
                  v-for="item in notificationSummary.latest.slice(0, 3)"
                  :key="item.notificationId"
                  class="rounded-md border border-default p-3"
                >
                  <p class="line-clamp-1 text-sm font-medium">
                    {{ item.displayLabel }}
                  </p>
                  <p class="mt-1 line-clamp-2 text-xs text-muted">
                    来自 {{ item.sourceAppCode }}
                  </p>
                </div>
              </div>
              <div v-else class="space-y-3">
                <div class="rounded-md border border-default p-3">
                  <p class="text-sm font-medium">
                    系统运行正常
                  </p>
                  <p class="mt-1 text-xs text-muted">
                    暂无新的公告。
                  </p>
                </div>
              </div>
            </UCard>
          </div>
        </section>
      </div>
    </template>
  </UDashboardPanel>
</template>
