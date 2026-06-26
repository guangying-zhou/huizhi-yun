<script setup lang="ts">
import type { ApiResponse, ProductAssetItem } from '~/types'
import { normalizeCustomerDomains, normalizeStringList, normalizeSupportedTerminals } from '~/utils/productAssets'

interface ProductVersionItem {
  id: number
  product_code: string
  version_code: string
  name?: string | null
  status: string
  planned_release_date?: string | null
  released_at?: string | null
  owner_project_name?: string | null
  owner_project_code?: string | null
  target_count?: number
  completed_count?: number
  progress_percent?: number
  features?: Array<Record<string, unknown>>
}

const route = useRoute()
const productId = computed(() => String(route.params.id))
const editOpen = ref(false)
const linkBaseOpen = ref(false)
const linkAssetOpen = ref(false)
const documentOpen = ref(false)
const { loadDictionaries, getLabel } = useAssetLabels()
await loadDictionaries()
const { data: response, refresh, error } = await useFetch<ApiResponse<ProductAssetItem>>(() => `/api/v1/products/${productId.value}`)
const {
  data: versionResponse,
  refresh: refreshVersions,
  pending: versionsPending,
  error: versionsError
} = await useFetch<ApiResponse<{ productCode: string, items: ProductVersionItem[] }>>(() => `/api/v1/products/${productId.value}/versions`)

if (error.value?.statusCode === 404) {
  throw createError({ statusCode: 404, message: '产品主档不存在' })
}

const product = computed(() => response.value?.data)
const versionStatusLabel: Record<string, string> = {
  planning: '规划中',
  developing: '开发中',
  released: '已发布',
  archived: '已归档'
}
const versionStatusColor: Record<string, string> = {
  planning: 'neutral',
  developing: 'info',
  released: 'success',
  archived: 'neutral'
}
const productLineLabel = computed(() => getLabel('product_line', product.value?.product_line))
const customerDomainLabel = computed(() => {
  const domains = normalizeCustomerDomains(product.value?.customer_domain)
  return domains.length > 0 ? domains.map(item => getLabel('customer_domain', item)).join('、') : '-'
})
const businessDomainLabel = computed(() => getLabel('business_domain', product.value?.business_domain))
const productLevelLabel = computed(() => getLabel('product_level', product.value?.product_level))
const assetLevelLabel = computed(() => getLabel('product_asset_value_type', product.value?.asset_level))
const statusLabel = computed(() => getLabel('product_status', product.value?.status))
const buildStageLabel = computed(() => getLabel('build_stage', product.value?.build_stage))
const productizationValueLabel = computed(() => getLabel('productization_value_level', product.value?.productization_value_level))
const supportedTerminalLabel = computed(() => {
  const terminals = normalizeSupportedTerminals(product.value?.supported_terminals)
  return terminals.length > 0 ? terminals.map(item => getLabel('supported_terminal', item)).join('、') : '-'
})
const coveredLegacySystems = computed(() => normalizeStringList(product.value?.covered_legacy_systems))
const documentTypeLabels: Record<string, string> = {
  requirement: '需求文档',
  design: '设计文档',
  api: '接口文档',
  ops: '运维文档',
  delivery: '交付文档',
  attachment: '附件',
  other: '其他'
}
const deliveryRelationTypeLabels: Record<string, string> = {
  delivered_product: '交付产品',
  supporting_product: '支撑产品',
  integrated_product: '集成产品'
}
const documentItems = computed(() => (product.value?.documents || []).map(item => ({
  ...item,
  document_type_label: documentTypeLabels[item.document_type] || item.document_type
})))

const baseItems = computed(() => (product.value?.linked_bases || []).map(item => ({
  ...item,
  base_type_label: getLabel('technology_base_type', item.base_type),
  status_label: getLabel('technology_base_status', item.status)
})))
const assetItems = computed(() => (product.value?.linked_assets || []).map(item => ({
  ...item,
  asset_category_label: `${getLabel('asset_category', item.asset_category)} / ${item.asset_subtype}`,
  relation_label: getLabel('product_asset_relation_type', item.relation_type),
  status_label: getLabel(item.asset_category === 'physical' ? 'asset_status_physical' : 'asset_status_resource', item.status),
  primary_label: item.is_primary ? '是' : '否'
})))
const versionItems = computed(() => (versionResponse.value?.data?.items || []).map(item => ({
  ...item,
  feature_count: Array.isArray(item.features) ? item.features.length : 0,
  owner_project_label: item.owner_project_name || item.owner_project_code || '-'
})))
const deliveryInstanceItems = computed(() => (product.value?.delivery_instances || []).map(item => ({
  ...item,
  status_label: getLabel('delivery_status', item.status),
  relation_label: deliveryRelationTypeLabels[item.relation_type] || item.relation_type
})))

const basicInfoItems = computed(() => {
  if (!product.value) {
    return []
  }

  return [
    { label: '产品线', value: productLineLabel.value },
    { label: '业务域', value: customerDomainLabel.value },
    { label: '业务域分类', value: businessDomainLabel.value },
    { label: '产品投资策略', value: productLevelLabel.value },
    { label: '资产价值类型', value: assetLevelLabel.value },
    { label: '建设阶段', value: buildStageLabel.value },
    { label: '当前版本', value: product.value.current_version || '-' },
    { label: '目标版本', value: product.value.target_version || '-' },
    { label: '产品化价值', value: productizationValueLabel.value },
    { label: '支持终端', value: supportedTerminalLabel.value },
    { label: '建设时间', value: product.value.built_at || '-' },
    { label: '业务负责人', value: product.value.business_owner_uid || '-' },
    { label: '技术负责人', value: product.value.technical_owner_uid || '-' },
    { label: '关联项目', value: product.value.project_code || '-' },
    { label: '关联资源数', value: product.value.asset_count },
    { label: '技术底座数', value: product.value.base_count }
  ]
})

const baseColumns = [
  { accessorKey: 'base_code', header: '底座编号' },
  { accessorKey: 'base_name', header: '底座名称' },
  { accessorKey: 'base_type_label', header: '底座类型' },
  { accessorKey: 'status_label', header: '状态' }
]

const assetColumns = [
  { accessorKey: 'asset_code', header: '资产编号' },
  { accessorKey: 'asset_name', header: '资产名称' },
  { accessorKey: 'asset_category_label', header: '资产分类' },
  { accessorKey: 'relation_label', header: '关联类型' },
  { accessorKey: 'status_label', header: '状态' },
  { accessorKey: 'primary_label', header: '主资源' }
]
const documentColumns = [
  { accessorKey: 'document_id', header: '文档编号' },
  { accessorKey: 'document_type_label', header: '类型' },
  { accessorKey: 'remark', header: '说明' }
]
const versionColumns = [
  { accessorKey: 'version_code', header: '版本' },
  { accessorKey: 'status', header: '状态' },
  { accessorKey: 'owner_project_label', header: '负责项目' },
  { accessorKey: 'planned_release_date', header: '计划发布日期' },
  { accessorKey: 'progress_percent', header: '进度' },
  { accessorKey: 'feature_count', header: '公开特性' }
]
const deliveryInstanceColumns = [
  { accessorKey: 'delivery_code', header: '交付编号' },
  { accessorKey: 'delivery_name', header: '交付名称' },
  { accessorKey: 'customer_code', header: '客户' },
  { accessorKey: 'contract_code', header: '合同' },
  { accessorKey: 'project_code', header: '项目' },
  { accessorKey: 'relation_label', header: '关联' },
  { accessorKey: 'status_label', header: '状态' }
]

const handleRefresh = async () => {
  await Promise.all([refresh(), refreshVersions()])
}
const handleUpdated = async () => {
  await handleRefresh()
}
</script>

<template>
  <UDashboardPanel id="product-detail" grow>
    <template #body>
      <Teleport to="#assets-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          {{ product?.product_name || '产品详情' }}
        </h1>
      </Teleport>
      <Teleport to="#assets-layout-header-actions">
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          to="/products"
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
          @click="linkBaseOpen = true"
        >
          关联底座
        </UButton>
        <UButton
          icon="i-lucide-link"
          color="primary"
          variant="soft"
          @click="linkAssetOpen = true"
        >
          关联资源
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
        <UCard v-if="product">
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-semibold">{{ product.product_code }}</span>
              <UBadge color="primary" variant="soft">
                {{ statusLabel }}
              </UBadge>
            </div>
          </template>

          <dl class="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-4 text-sm">
            <div
              v-for="item in basicInfoItems"
              :key="item.label"
              class="min-w-0"
            >
              <dt class="text-xs text-muted">
                {{ item.label }}
              </dt>
              <dd class="mt-1 font-medium text-default break-words">
                {{ item.value }}
              </dd>
            </div>
          </dl>

          <div class="mt-4 space-y-3 text-sm">
            <div>
              <p class="text-muted">
                产品简述
              </p>
              <p>{{ product.summary || '暂无简述' }}</p>
            </div>
            <div>
              <p class="text-muted">
                涵盖已有系统
              </p>
              <p>{{ coveredLegacySystems.length > 0 ? coveredLegacySystems.join('、') : '暂无记录' }}</p>
            </div>
            <div>
              <p class="text-muted">
                备注
              </p>
              <p>{{ product.notes || '暂无备注' }}</p>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">版本路线</span>
              <UBadge color="neutral" variant="soft">
                Aims
              </UBadge>
            </div>
          </template>

          <div v-if="versionsPending" class="flex items-center justify-center py-8 text-muted">
            <UIcon name="i-lucide-loader-2" class="size-5 animate-spin" />
          </div>
          <UAlert
            v-else-if="versionsError"
            color="warning"
            variant="soft"
            icon="i-lucide-alert-circle"
            title="暂时无法加载版本路线"
            :description="versionsError.message"
          />
          <UTable v-else :data="versionItems" :columns="versionColumns">
            <template #version_code-cell="{ row }">
              <div class="min-w-0">
                <p class="font-medium text-default">
                  {{ row.original.version_code }}
                </p>
                <p v-if="row.original.name" class="text-xs text-muted truncate">
                  {{ row.original.name }}
                </p>
              </div>
            </template>
            <template #status-cell="{ row }">
              <UBadge :color="(versionStatusColor[row.original.status] as any) || 'neutral'" variant="subtle" size="xs">
                {{ versionStatusLabel[row.original.status] || row.original.status }}
              </UBadge>
            </template>
            <template #planned_release_date-cell="{ row }">
              {{ row.original.planned_release_date || '-' }}
            </template>
            <template #progress_percent-cell="{ row }">
              <div class="min-w-32 space-y-1">
                <UProgress :model-value="Number(row.original.progress_percent || 0)" />
                <p class="text-xs text-muted">
                  {{ Number(row.original.completed_count || 0) }}/{{ Number(row.original.target_count || 0) }} 目标
                </p>
              </div>
            </template>
            <template #feature_count-cell="{ row }">
              {{ row.original.feature_count || 0 }}
            </template>
          </UTable>
        </UCard>

        <UCard>
          <template #header>
            <span class="font-semibold">技术底座</span>
          </template>
          <UTable :data="baseItems" :columns="baseColumns" />
        </UCard>

        <UCard>
          <template #header>
            <span class="font-semibold">关联资源</span>
          </template>
          <UTable :data="assetItems" :columns="assetColumns" />
        </UCard>

        <UCard>
          <template #header>
            <span class="font-semibold">关联文档</span>
          </template>
          <UTable :data="documentItems" :columns="documentColumns" />
        </UCard>

        <UCard>
          <template #header>
            <span class="font-semibold">交付实例</span>
          </template>
          <UTable :data="deliveryInstanceItems" :columns="deliveryInstanceColumns" />
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <AssetsProductAssetEditModal
    :open="editOpen"
    :product="product || null"
    @update:open="editOpen = $event"
    @updated="handleUpdated"
  />

  <AssetsProductBaseLinkModal
    :open="linkBaseOpen"
    :product="product || null"
    @update:open="linkBaseOpen = $event"
    @created="handleUpdated"
  />

  <AssetsProductResourceLinkModal
    :open="linkAssetOpen"
    :product="product || null"
    @update:open="linkAssetOpen = $event"
    @created="handleUpdated"
  />

  <AssetsProductDocumentLinkModal
    :open="documentOpen"
    :product="product || null"
    @update:open="documentOpen = $event"
    @created="handleUpdated"
  />
</template>
