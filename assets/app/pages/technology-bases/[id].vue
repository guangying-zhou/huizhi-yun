<script setup lang="ts">
import type { ApiResponse, TechnologyBaseItem } from '~/types'

const route = useRoute()
const baseId = computed(() => String(route.params.id))
const editOpen = ref(false)
const { loadDictionaries, getLabel } = useAssetLabels()
await loadDictionaries()
const { data: response, refresh, error } = await useFetch<ApiResponse<TechnologyBaseItem>>(() => `/api/v1/technology-bases/${baseId.value}`)

if (error.value?.statusCode === 404) {
  throw createError({ statusCode: 404, message: '技术底座不存在' })
}

const base = computed(() => response.value?.data)
const baseTypeLabel = computed(() => getLabel('technology_base_type', base.value?.base_type))
const assetLevelLabel = computed(() => getLabel('asset_level', base.value?.asset_level))
const statusLabel = computed(() => getLabel('technology_base_status', base.value?.status))
const productItems = computed(() => (base.value?.related_products || []).map(item => ({
  ...item,
  status_label: getLabel('product_status', item.status)
})))
const productColumns = [
  { accessorKey: 'product_code', header: '产品编码' },
  { accessorKey: 'product_name', header: '产品名称' },
  { accessorKey: 'status_label', header: '状态' }
]

const handleRefresh = () => refresh()
const handleUpdated = async () => {
  await refresh()
}
</script>

<template>
  <UDashboardPanel id="technology-base-detail" grow>
    <template #body>
      <Teleport to="#assets-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          {{ base?.base_name || '技术底座详情' }}
        </h1>
      </Teleport>
      <Teleport to="#assets-layout-header-actions">
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          to="/technology-bases"
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
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          @click="handleRefresh"
        >
          刷新
        </UButton>
      </Teleport>

      <div class="p-4 space-y-4">
        <UCard v-if="base">
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-semibold">{{ base.base_code }}</span>
              <UBadge color="info" variant="soft">
                {{ statusLabel }}
              </UBadge>
            </div>
          </template>

          <div class="grid gap-3 md:grid-cols-2 text-sm">
            <div><span class="text-muted">底座类型：</span>{{ baseTypeLabel }}</div>
            <div><span class="text-muted">资产分级：</span>{{ assetLevelLabel }}</div>
            <div><span class="text-muted">负责人：</span>{{ base.owner_uid || '-' }}</div>
            <div><span class="text-muted">技术负责人：</span>{{ base.technical_owner_uid || '-' }}</div>
            <div><span class="text-muted">关联项目：</span>{{ base.project_code || '-' }}</div>
            <div><span class="text-muted">服务产品数：</span>{{ base.product_count }}</div>
          </div>

          <div class="mt-4 space-y-3 text-sm">
            <div>
              <p class="text-muted">
                服务对象
              </p>
              <p>{{ base.service_targets || '暂无说明' }}</p>
            </div>
            <div>
              <p class="text-muted">
                备注
              </p>
              <p>{{ base.notes || '暂无备注' }}</p>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <span class="font-semibold">关联产品</span>
          </template>
          <UTable :data="productItems" :columns="productColumns" />
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <AssetsTechnologyBaseEditModal
    :open="editOpen"
    :base="base || null"
    @update:open="editOpen = $event"
    @updated="handleUpdated"
  />
</template>
