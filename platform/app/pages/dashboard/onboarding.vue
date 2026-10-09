<script setup lang="ts">
definePageMeta({
  layout: 'console'
})

usePageTitle('租户开通向导')

type SubscriptionStage = 'not_subscribed' | 'selected' | 'deployment_pending' | 'active' | 'grace' | 'authorization_blocked'

interface TenantSummary {
  tenantCode: string
  tenantName: string
  displayName: string | null
  status: string
  defaultAuthMode: string
  defaultDeploymentMode: string
}

interface SubscriptionItem {
  stage: {
    key: SubscriptionStage
    label: string
  }
  deployment: null | {
    id: number
    status: string
  }
  license: null | {
    id: number
  }
}

const { currentTenantCode } = useTenantContext()

const pending = ref(false)
const notice = ref<string | null>(null)
const tenant = ref<TenantSummary | null>(null)
const subscriptions = ref<SubscriptionItem[]>([])

const stats = computed(() => ({
  totalApps: subscriptions.value.length,
  selectedApps: subscriptions.value.filter(item => item.stage.key !== 'not_subscribed').length,
  licensedApps: subscriptions.value.filter(item => !!item.license).length,
  activeApps: subscriptions.value.filter(item => item.stage.key === 'active').length
}))

const checklist = computed(() => ([
  {
    title: '确认租户主档',
    description: tenant.value
      ? `当前租户：${tenant.value.displayName || tenant.value.tenantName}（${tenant.value.tenantCode}）`
      : '先锁定租户上下文并确认租户主档存在。',
    completed: Boolean(tenant.value)
  },
  {
    title: '确认登录模式',
    description: tenant.value?.defaultAuthMode
      ? `当前默认登录模式：${tenant.value.defaultAuthMode}`
      : '尚未读取到默认登录模式。',
    completed: Boolean(tenant.value?.defaultAuthMode)
  },
  {
    title: '选择启用应用',
    description: `当前已选择 ${stats.value.selectedApps} 个应用。`,
    completed: stats.value.selectedApps > 0
  },
  {
    title: '完成授权确认',
    description: `当前已签发 ${stats.value.licensedApps} 个应用的授权。`,
    completed: stats.value.licensedApps > 0
  },
  {
    title: '完善部署',
    description: `当前有 ${subscriptions.value.filter(item => item.deployment?.status === 'active').length} 个应用部署处于运行中。`,
    completed: subscriptions.value.some(item => item.deployment?.status === 'active')
  },
  {
    title: '正式启用',
    description: `当前有 ${stats.value.activeApps} 个应用处于正式启用。`,
    completed: stats.value.activeApps > 0
  }
]))

async function loadTenantSummary() {
  if (!currentTenantCode.value) {
    tenant.value = null
    subscriptions.value = []
    return
  }

  pending.value = true
  notice.value = null

  try {
    const [tenantResponse, subscriptionsResponse] = await Promise.all([
      platformFetchJson<{ success: true, data: { items: TenantSummary[] } }>('/api/platform/tenant-admin/tenants', {
        query: {
          keyword: currentTenantCode.value,
          page: 1,
          pageSize: 20
        }
      }),
      platformFetchJson<{ success: true, data: { items: SubscriptionItem[] } }>('/api/platform/tenant-admin/subscriptions', {
        query: {
          tenantCode: currentTenantCode.value,
          page: 1,
          pageSize: 100
        }
      })
    ])

    tenant.value = tenantResponse.data.items.find(item => item.tenantCode === currentTenantCode.value) || null
    subscriptions.value = subscriptionsResponse.data.items
  } catch (error) {
    notice.value = error instanceof Error ? error.message : '开通信息加载失败'
  } finally {
    pending.value = false
  }
}

watch(() => currentTenantCode.value, () => {
  loadTenantSummary()
}, { immediate: true })
</script>

<template>
  <UDashboardPanel
    id="tenant-onboarding"
    :ui="{ body: 'console-page' }"
  >
    <template #body>
      <section class="console-hero">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 class="text-xl font-semibold text-highlighted">
              租户开通向导
            </h1>
            <p class="mt-1 max-w-2xl text-sm text-muted">
              按“租户资料 → 登录模式 → 应用选择 → 授权确认 → 部署 → 正式启用”的顺序推进，不再靠零散页面自己摸索。
            </p>
          </div>
          <UButton
            color="neutral"
            variant="soft"
            icon="i-lucide-refresh-cw"
            :loading="pending"
            @click="loadTenantSummary"
          >
            刷新开通状态
          </UButton>
        </div>
      </section>

      <section class="grid gap-4 xl:grid-cols-[1.25fr_0.95fr]">
        <UCard>
          <div
            v-if="!currentTenantCode"
            class="rounded-lg border border-dashed border-default px-4 py-10 text-center text-sm text-muted"
          >
            先回到租户管理台首页锁定当前租户，再进入开通向导。
          </div>

          <div
            v-else
            class="space-y-4"
          >
            <div
              v-if="notice"
              class="tenant-notice"
              data-tone="error"
            >
              {{ notice }}
            </div>

            <div class="grid gap-3 md:grid-cols-3">
              <div class="rounded-lg border border-default bg-muted px-4 py-3">
                <p class="text-xs font-medium text-muted">
                  当前租户
                </p>
                <p class="mt-1 text-base font-semibold text-highlighted">
                  {{ tenant?.displayName || tenant?.tenantName || currentTenantCode }}
                </p>
                <p class="text-sm text-muted">
                  {{ currentTenantCode }}
                </p>
              </div>
              <div class="rounded-lg border border-default bg-muted px-4 py-3">
                <p class="text-xs font-medium text-muted">
                  应用选择
                </p>
                <p class="mt-1 text-base font-semibold text-highlighted">
                  {{ stats.selectedApps }}
                </p>
                <p class="text-sm text-muted">
                  共 {{ stats.totalApps }} 个可纳管应用
                </p>
              </div>
              <div class="rounded-lg border border-default bg-muted px-4 py-3">
                <p class="text-xs font-medium text-muted">
                  正式启用
                </p>
                <p class="mt-1 text-base font-semibold text-highlighted">
                  {{ stats.activeApps }}
                </p>
                <p class="text-sm text-muted">
                  已签发授权 {{ stats.licensedApps }}
                </p>
              </div>
            </div>

            <div class="space-y-3">
              <div
                v-for="(item, index) in checklist"
                :key="item.title"
                class="rounded-lg border px-4 py-3"
                :class="item.completed ? 'border-success/40 bg-success/10' : 'border-default bg-default'"
              >
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <p class="text-xs font-medium text-dimmed">
                      步骤 {{ index + 1 }}
                    </p>
                    <h2 class="mt-1 text-base font-semibold text-highlighted">
                      {{ item.title }}
                    </h2>
                    <p class="mt-1 text-sm text-muted">
                      {{ item.description }}
                    </p>
                  </div>
                  <UBadge
                    :color="item.completed ? 'success' : 'neutral'"
                    variant="soft"
                  >
                    {{ item.completed ? '已完成' : '待处理' }}
                  </UBadge>
                </div>
              </div>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <h2 class="text-base font-semibold text-highlighted">
              下一步动作
            </h2>
          </template>

          <div class="space-y-3">
            <NuxtLink
              to="/dashboard/applications"
              class="block rounded-lg border border-default bg-default p-4 transition hover:border-primary/40 hover:bg-elevated/50"
            >
              <p class="text-sm font-semibold text-highlighted">去选择/启用应用</p>
              <p class="mt-1 text-sm text-muted">查看当前租户所有应用的启用阶段，并继续补授权与部署。</p>
            </NuxtLink>

            <NuxtLink
              to="/dashboard/users"
              class="block rounded-lg border border-default bg-default p-4 transition hover:border-primary/40 hover:bg-elevated/50"
            >
              <p class="text-sm font-semibold text-highlighted">去完善用户资料</p>
              <p class="mt-1 text-sm text-muted">先把租户用户与主体目录补齐，后续权限模板和身份映射才能稳定运行。</p>
            </NuxtLink>
          </div>
        </UCard>
      </section>
    </template>
  </UDashboardPanel>
</template>
