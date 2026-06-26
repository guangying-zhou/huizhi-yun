<script setup lang="ts">
import { computed, ref, watch } from 'vue'

interface CatalogPlan {
  planCode: string
  planName: string | null
  planTier: string | null
}

interface CatalogApp {
  appCode: string
  appName: string
  description: string | null
  icon: string | null
  enabled: boolean
  requiredPlan: CatalogPlan | null
}

interface CatalogResponse {
  currentPlan: CatalogPlan | null
  applications: CatalogApp[]
}

const { currentTenantCode } = useTenantContext()

const pending = ref(false)
const error = ref('')
const currentPlan = ref<CatalogPlan | null>(null)
const applications = ref<CatalogApp[]>([])

const enabledApps = computed(() => applications.value.filter(app => app.enabled))
const upgradeApps = computed(() => applications.value.filter(app => !app.enabled))

function appIcon(app: CatalogApp) {
  return app.icon || 'i-lucide-app-window'
}

async function loadCatalog() {
  const tenantCode = currentTenantCode.value?.trim()
  if (!tenantCode) {
    applications.value = []
    currentPlan.value = null
    return
  }

  pending.value = true
  error.value = ''

  try {
    const fetchJson = $fetch as <T>(request: string, options?: {
      query?: Record<string, string>
    }) => Promise<T>
    const response = await fetchJson<{ data: CatalogResponse }>('/api/platform/tenant-admin/application-catalog', {
      query: { tenantCode }
    })
    currentPlan.value = response.data.currentPlan
    applications.value = response.data.applications
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : '加载应用目录失败'
  } finally {
    pending.value = false
  }
}

function goSubscription() {
  navigateTo('/dashboard/subscription-plans')
}

watch(() => currentTenantCode.value, () => loadCatalog(), { immediate: true })
</script>

<template>
  <UDashboardPanel
    id="dashboard-application-catalog"
    :ui="{ body: 'console-page' }"
  >
    <template #body>
      <section class="console-hero">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 class="text-xl font-semibold text-highlighted">
              应用中心
            </h1>
            <p class="mt-1 text-sm text-muted">
              查看企业可用的业务应用。订阅计划包含的应用会自动开通，无需逐个启用。
            </p>
          </div>
          <UBadge
            v-if="currentPlan"
            color="primary"
            variant="soft"
            size="lg"
          >
            当前套餐 · {{ currentPlan.planName || currentPlan.planCode }}
          </UBadge>
        </div>
      </section>

      <UCard :ui="{ body: 'space-y-6' }">
        <UAlert
          v-if="error"
          color="error"
          variant="soft"
          icon="i-lucide-alert-triangle"
          :title="error"
        />

        <section class="space-y-3">
          <div class="flex items-center gap-2">
            <h2 class="text-sm font-medium text-highlighted">
              已开通
            </h2>
            <UBadge
              color="success"
              variant="soft"
              size="sm"
            >
              {{ enabledApps.length }}
            </UBadge>
          </div>

          <div
            v-if="enabledApps.length"
            class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
          >
            <div
              v-for="app in enabledApps"
              :key="app.appCode"
              class="flex flex-col gap-2 rounded-lg border border-default bg-default p-4"
            >
              <div class="flex items-center gap-3">
                <UIcon
                  :name="appIcon(app)"
                  class="size-6 shrink-0 text-primary"
                />
                <p class="min-w-0 flex-1 truncate text-sm font-medium text-highlighted">
                  {{ app.appName }}
                </p>
                <UBadge
                  color="success"
                  variant="soft"
                  size="sm"
                >
                  已开通
                </UBadge>
              </div>
              <p
                v-if="app.description"
                class="line-clamp-2 text-xs text-muted"
              >
                {{ app.description }}
              </p>
            </div>
          </div>
          <p
            v-else-if="!pending"
            class="text-sm text-muted"
          >
            当前套餐暂未包含业务应用。
          </p>
        </section>

        <section
          v-if="upgradeApps.length"
          class="space-y-3"
        >
          <div class="flex items-center gap-2">
            <h2 class="text-sm font-medium text-highlighted">
              升级可解锁
            </h2>
            <UBadge
              color="neutral"
              variant="soft"
              size="sm"
            >
              {{ upgradeApps.length }}
            </UBadge>
          </div>

          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <div
              v-for="app in upgradeApps"
              :key="app.appCode"
              class="flex flex-col gap-2 rounded-lg border border-default bg-muted p-4"
            >
              <div class="flex items-center gap-3">
                <UIcon
                  :name="appIcon(app)"
                  class="size-6 shrink-0 text-dimmed"
                />
                <p class="min-w-0 flex-1 truncate text-sm font-medium text-highlighted">
                  {{ app.appName }}
                </p>
                <UBadge
                  color="warning"
                  variant="soft"
                  size="sm"
                >
                  需 {{ app.requiredPlan?.planName || '更高套餐' }}
                </UBadge>
              </div>
              <p
                v-if="app.description"
                class="line-clamp-2 text-xs text-muted"
              >
                {{ app.description }}
              </p>
              <UButton
                color="primary"
                variant="soft"
                size="sm"
                icon="i-lucide-arrow-up-circle"
                class="mt-1 self-start"
                @click="goSubscription"
              >
                去开通
              </UButton>
            </div>
          </div>
        </section>
      </UCard>
    </template>
  </UDashboardPanel>
</template>
