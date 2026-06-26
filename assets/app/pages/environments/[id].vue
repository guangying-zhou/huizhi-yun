<script setup lang="ts">
import type { ApiResponse, EnvironmentItem } from '~/types'

const route = useRoute()
const environmentId = computed(() => String(route.params.id))
const editOpen = ref(false)
const bindOpen = ref(false)
const { loadDictionaries, getLabel } = useAssetLabels()
await loadDictionaries()
const { data: response, refresh, error } = await useFetch<ApiResponse<EnvironmentItem>>(() => `/api/v1/environments/${environmentId.value}`)

if (error.value?.statusCode === 404) {
  throw createError({ statusCode: 404, message: '环境不存在' })
}

const environment = computed(() => response.value?.data)
const environmentStatusLabel = computed(() => getLabel('environment_status', environment.value?.status))
const environmentTypeLabel = computed(() => getLabel('environment_type', environment.value?.environment_type))
const relationTypeLabels: Record<string, string> = {
  compute: '计算资源',
  database: '数据库',
  middleware: '中间件',
  seat: 'Seat',
  quota: '额度',
  domain_cert: '域名证书',
  security: '安全能力',
  delivery_artifact: '交付物',
  other: '其他'
}
const linkedAssets = computed(() => (environment.value?.linked_assets || []).map(item => ({
  ...item,
  relation_label: relationTypeLabels[item.relation_type] || item.relation_type,
  category_label: `${getLabel('asset_category', item.asset_category)} / ${item.asset_subtype}`,
  status_label: getLabel(item.asset_category === 'physical' ? 'asset_status_physical' : 'asset_status_resource', item.status),
  primary_label: item.is_primary ? '是' : '否'
})))
const assetColumns = [
  { accessorKey: 'asset_code', header: '资产编号' },
  { accessorKey: 'asset_name', header: '资产名称' },
  { accessorKey: 'category_label', header: '资产分类' },
  { accessorKey: 'relation_label', header: '关联类型' },
  { accessorKey: 'status_label', header: '状态' },
  { accessorKey: 'primary_label', header: '主资产' }
]
const handleRefresh = () => refresh()
const handleUpdated = async () => {
  await refresh()
}
const handleBound = async () => {
  await refresh()
}
</script>

<template>
  <UDashboardPanel id="environment-detail" grow>
    <template #body>
      <Teleport to="#assets-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          {{ environment?.environment_name || '环境详情' }}
        </h1>
      </Teleport>
      <Teleport to="#assets-layout-header-actions">
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          to="/environments"
        >
          返回
        </UButton>
        <UButton
          icon="i-lucide-pencil"
          color="primary"
          variant="soft"
          @click="editOpen = true"
        >
          编辑
        </UButton>
        <UButton
          icon="i-lucide-link-2"
          color="primary"
          variant="soft"
          @click="bindOpen = true"
        >
          绑定资产
        </UButton>
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          @click="handleRefresh"
        >
          刷新
        </UButton>
      </Teleport>

      <div class="p-4">
        <UCard v-if="environment">
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-semibold">{{ environment.environment_code }}</span>
              <UBadge color="info" variant="soft">
                {{ environmentStatusLabel }}
              </UBadge>
            </div>
          </template>

          <div class="grid gap-3 md:grid-cols-2 text-sm">
            <div><span class="text-muted">环境类型：</span>{{ environmentTypeLabel }}</div>
            <div><span class="text-muted">项目：</span>{{ environment.project_code }}</div>
            <div><span class="text-muted">客户：</span>{{ environment.customer_code || '-' }}</div>
            <div><span class="text-muted">合同：</span>{{ environment.contract_code || '-' }}</div>
            <div><span class="text-muted">负责人：</span>{{ environment.owner_uid || '-' }}</div>
            <div><span class="text-muted">维护人：</span>{{ environment.maintainer_uid || '-' }}</div>
            <div><span class="text-muted">资产数量：</span>{{ environment.asset_count }}</div>
            <div><span class="text-muted">月度成本：</span>¥{{ environment.monthly_cost }}</div>
          </div>
          <div class="mt-4 space-y-3 text-sm">
            <div>
              <p class="text-muted">
                拓扑摘要
              </p>
              <p>{{ environment.topology_summary || '暂无拓扑摘要' }}</p>
            </div>
            <div>
              <p class="text-muted">
                备注
              </p>
              <p>{{ environment.notes || '暂无备注' }}</p>
            </div>
          </div>
        </UCard>

        <UCard v-if="environment">
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-semibold">已绑定资产</span>
              <UBadge color="neutral" variant="soft">
                {{ environment.linked_assets?.length || 0 }} 项
              </UBadge>
            </div>
          </template>
          <UTable :data="linkedAssets" :columns="assetColumns" />
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <AssetsEnvironmentEditModal
    :open="editOpen"
    :environment="environment || null"
    @update:open="editOpen = $event"
    @updated="handleUpdated"
  />

  <AssetsEnvironmentAssetBindModal
    :open="bindOpen"
    :environment="environment || null"
    @update:open="bindOpen = $event"
    @created="handleBound"
  />
</template>
