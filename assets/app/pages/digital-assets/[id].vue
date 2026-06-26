<script setup lang="ts">
import type { ApiResponse, DigitalAssetItem } from '~/types'

const route = useRoute()
const assetId = computed(() => String(route.params.id))
const editOpen = ref(false)
const linkProductOpen = ref(false)
const documentOpen = ref(false)
const { loadDictionaries, getLabel } = useAssetLabels()
await loadDictionaries()
const { data: response, refresh, error } = await useFetch<ApiResponse<DigitalAssetItem>>(() => `/api/v1/digital-assets/${assetId.value}`)

if (error.value?.statusCode === 404) {
  throw createError({ statusCode: 404, message: '数字资产不存在' })
}

const asset = computed(() => response.value?.data)
const typeLabel = computed(() => getLabel('digital_asset_type', asset.value?.digital_type))
const statusLabel = computed(() => getLabel('digital_asset_status', asset.value?.status))
const accessScopeLabel = computed(() => getLabel('digital_access_scope', asset.value?.access_scope))
const documentTypeLabels: Record<string, string> = {
  requirement: '需求文档',
  design: '设计文档',
  api: '接口文档',
  ops: '运维文档',
  delivery: '交付文档',
  attachment: '附件',
  other: '其他'
}
const documentItems = computed(() => (asset.value?.documents || []).map(item => ({
  ...item,
  document_type_label: documentTypeLabels[item.document_type] || item.document_type
})))
const linkedProducts = computed(() => (asset.value?.linked_products || []).map(item => ({
  ...item,
  status_label: getLabel('product_status', item.status)
})))
const documentColumns = [
  { accessorKey: 'document_id', header: '文档编号' },
  { accessorKey: 'document_type_label', header: '类型' },
  { accessorKey: 'remark', header: '说明' }
]
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
  <UDashboardPanel id="digital-asset-detail" grow>
    <template #body>
      <Teleport to="#assets-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          {{ asset?.digital_name || '数字资产详情' }}
        </h1>
      </Teleport>
      <Teleport to="#assets-layout-header-actions">
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          to="/assets/digital"
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
          @click="linkProductOpen = true"
        >
          关联产品
        </UButton>
        <UButton
          icon="i-lucide-file-text"
          color="primary"
          variant="soft"
          @click="documentOpen = true"
        >
          关联文档
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
        <UCard v-if="asset">
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-semibold">{{ asset.digital_code }}</span>
              <UBadge color="info" variant="soft">
                {{ statusLabel }}
              </UBadge>
            </div>
          </template>
          <div class="grid gap-3 md:grid-cols-2 text-sm">
            <div><span class="text-muted">子类型：</span>{{ typeLabel }}</div>
            <div><span class="text-muted">访问权限：</span>{{ accessScopeLabel }}</div>
            <div><span class="text-muted">负责人：</span>{{ asset.owner_uid || '-' }}</div>
            <div><span class="text-muted">关联项目：</span>{{ asset.project_code || '-' }}</div>
            <div><span class="text-muted">关联环境：</span>{{ asset.environment_name || '-' }}</div>
            <div><span class="text-muted">关联产品数：</span>{{ asset.product_count }}</div>
            <div class="md:col-span-2">
              <span class="text-muted">存储位置：</span>{{ asset.storage_location || '-' }}
            </div>
          </div>
          <p class="mt-4 text-sm text-muted">
            {{ asset.notes || '暂无备注' }}
          </p>
        </UCard>

        <UCard>
          <template #header>
            <span class="font-semibold">关联产品</span>
          </template>
          <UTable :data="linkedProducts" :columns="productColumns" />
        </UCard>

        <UCard>
          <template #header>
            <span class="font-semibold">关联文档</span>
          </template>
          <UTable :data="documentItems" :columns="documentColumns" />
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <AssetsDigitalAssetEditModal
    :open="editOpen"
    :asset="asset || null"
    @update:open="editOpen = $event"
    @updated="handleUpdated"
  />
  <AssetsDigitalAssetProductLinkModal
    :open="linkProductOpen"
    :asset="asset || null"
    @update:open="linkProductOpen = $event"
    @created="handleUpdated"
  />
  <AssetsDigitalAssetDocumentLinkModal
    :open="documentOpen"
    :asset="asset || null"
    @update:open="documentOpen = $event"
    @created="handleUpdated"
  />
</template>
