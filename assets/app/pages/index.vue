<script setup lang="ts">
import type { AlertItem, ApiResponse, AssetListItem, DashboardOverview, QuickLinkItem, SummaryMetric } from '~/types'

const { loadDictionaries, getLabel } = useAssetLabels()
await loadDictionaries()
const { data: response, refresh } = await useFetch<ApiResponse<DashboardOverview>>('/api/v1/dashboard/overview')

const metrics = computed<SummaryMetric[]>(() => response.value?.data.metrics || [])
const quickLinks = computed<QuickLinkItem[]>(() => response.value?.data.quick_links || [])
const urgentAlerts = computed<AlertItem[]>(() => response.value?.data.urgent_alerts || [])
const expiringAssets = computed<AssetListItem[]>(() => response.value?.data.expiring_assets || [])
const displayAlerts = computed(() => urgentAlerts.value.map(item => ({
  ...item,
  status_label: getLabel('alert_status', item.status)
})))
const displayExpiringAssets = computed(() => expiringAssets.value.map(item => ({
  ...item,
  status_label: getLabel(item.asset_category === 'physical' ? 'asset_status_physical' : 'asset_status_resource', item.status)
})))

const alertColumns = [
  { accessorKey: 'alert_no', header: '预警编号' },
  { accessorKey: 'title', header: '标题' },
  { accessorKey: 'status_label', header: '状态' },
  { accessorKey: 'triggered_at', header: '触发时间' }
]

const expiringColumns = [
  { accessorKey: 'asset_code', header: '资产编号' },
  { accessorKey: 'asset_name', header: '资产名称' },
  { accessorKey: 'status_label', header: '状态' },
  { accessorKey: 'expires_at', header: '到期时间' }
]

const getBadgeColor = (color?: SummaryMetric['color']) => color || 'neutral'

const handleAlertSelect = (_event: Event, _row: { original: AlertItem }) => {
  navigateTo('/alerts')
}

const handleAssetSelect = (_event: Event, row: { original: AssetListItem }) => {
  navigateTo(`/assets/${row.original.public_id || row.original.id}`)
}

const handleRefresh = () => refresh()
</script>

<template>
  <UDashboardPanel id="dashboard" grow>
    <template #body>
      <Teleport to="#assets-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          Assets 工作台
        </h1>
      </Teleport>
      <Teleport to="#assets-layout-header-actions">
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          @click="handleRefresh"
        >
          刷新
        </UButton>
      </Teleport>

      <div class="p-4 space-y-4">
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <UCard
            v-for="metric in metrics"
            :key="metric.label"
            variant="subtle"
            :ui="{ body: 'space-y-1' }"
          >
            <p class="text-sm text-muted">
              {{ metric.label }}
            </p>
            <p class="text-2xl font-semibold">
              {{ metric.value }}
            </p>
            <UBadge :color="getBadgeColor(metric.color)" variant="soft">
              {{ metric.hint || '实时汇总' }}
            </UBadge>
          </UCard>
        </div>

        <div class="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
          <UCard>
            <template #header>
              <div class="flex items-center justify-between">
                <span class="font-semibold">快捷入口</span>
                <UBadge color="neutral" variant="soft">
                  {{ quickLinks.length }} 个
                </UBadge>
              </div>
            </template>

            <div class="grid gap-3 md:grid-cols-2">
              <NuxtLink
                v-for="link in quickLinks"
                :key="link.to"
                :to="link.to"
                class="rounded-lg border border-default p-4 transition hover:border-primary/50 hover:bg-accented"
              >
                <div class="flex items-start gap-3">
                  <UIcon :name="link.icon" class="mt-0.5 size-5 text-primary" />
                  <div class="space-y-1">
                    <p class="font-medium">
                      {{ link.label }}
                    </p>
                    <p class="text-sm text-muted">
                      {{ link.description }}
                    </p>
                  </div>
                </div>
              </NuxtLink>
            </div>
          </UCard>

          <UCard>
            <template #header>
              <span class="font-semibold">当前说明</span>
            </template>
            <div class="space-y-2 text-sm text-muted">
              <p>当前已补齐 Assets 的权限资源、页面路由和 `/api/v1/**` 接口链路。</p>
              <p>资产、环境、交付、采购、预警和报表页现在读取 MySQL 数据，可继续接入外部模块主数据与流程回调。</p>
            </div>
          </UCard>
        </div>

        <div class="grid gap-4 xl:grid-cols-2">
          <UCard>
            <template #header>
              <div class="flex items-center justify-between">
                <span class="font-semibold">待处理预警</span>
                <NuxtLink to="/alerts" class="text-sm text-primary hover:underline">
                  查看全部
                </NuxtLink>
              </div>
            </template>

            <UTable
              :data="displayAlerts"
              :columns="alertColumns"
              @select="handleAlertSelect"
            />
          </UCard>

          <UCard>
            <template #header>
              <div class="flex items-center justify-between">
                <span class="font-semibold">即将到期资产</span>
                <NuxtLink to="/assets/resources" class="text-sm text-primary hover:underline">
                  查看资源资产
                </NuxtLink>
              </div>
            </template>

            <UTable
              :data="displayExpiringAssets"
              :columns="expiringColumns"
              @select="handleAssetSelect"
            />
          </UCard>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
