<script setup lang="ts">
import type { ApiResponse, IpAssetItem } from '~/types'

const route = useRoute()
const assetId = computed(() => String(route.params.id))
const editOpen = ref(false)
const linkProductOpen = ref(false)
const documentOpen = ref(false)
const { loadDictionaries, getLabel } = useAssetLabels()
await loadDictionaries()
const { data: response, refresh, error } = await useFetch<ApiResponse<IpAssetItem>>(() => `/api/v1/ip-assets/${assetId.value}`)

if (error.value?.statusCode === 404) {
  throw createError({ statusCode: 404, message: '知识产权资产不存在' })
}

const asset = computed(() => response.value?.data)
const typeLabel = computed(() => getLabel('ip_asset_type', asset.value?.ip_type))
const statusLabel = computed(() => getLabel('ip_asset_status', asset.value?.status))
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
  <UDashboardPanel id="ip-asset-detail" grow>
    <template #body>
      <Teleport to="#assets-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          {{ asset?.ip_name || '知识产权详情' }}
        </h1>
      </Teleport>
      <Teleport to="#assets-layout-header-actions">
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          to="/assets/ip"
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
              <span class="font-semibold">{{ asset.ip_code }}</span>
              <UBadge color="warning" variant="soft">
                {{ statusLabel }}
              </UBadge>
            </div>
          </template>
          <div class="grid gap-3 md:grid-cols-2 text-sm">
            <div><span class="text-muted">类型：</span>{{ typeLabel }}</div>
            <div><span class="text-muted">登记号：</span>{{ asset.registration_no || '-' }}</div>
            <div><span class="text-muted">权利人：</span>{{ asset.right_holder || '-' }}</div>
            <div><span class="text-muted">维护负责人：</span>{{ asset.owner_uid || '-' }}</div>
            <div><span class="text-muted">申请日期：</span>{{ asset.apply_date || '-' }}</div>
            <div><span class="text-muted">授权/有效日期：</span>{{ asset.effective_date || '-' }}</div>
            <div><span class="text-muted">到期日期：</span>{{ asset.expires_at || '-' }}</div>
            <div><span class="text-muted">关联产品数：</span>{{ asset.product_count }}</div>
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

  <AssetsIpAssetEditModal
    :open="editOpen"
    :asset="asset || null"
    @update:open="editOpen = $event"
    @updated="handleUpdated"
  />
  <AssetsIpAssetProductLinkModal
    :open="linkProductOpen"
    :asset="asset || null"
    @update:open="linkProductOpen = $event"
    @created="handleUpdated"
  />
  <AssetsIpAssetDocumentLinkModal
    :open="documentOpen"
    :asset="asset || null"
    @update:open="documentOpen = $event"
    @created="handleUpdated"
  />
</template>
