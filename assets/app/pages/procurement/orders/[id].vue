<script setup lang="ts">
import type { ApiResponse, PurchaseOrderItem, PurchaseOrderLineItem } from '~/types'

interface PurchaseOrderDetail extends PurchaseOrderItem {
  items: PurchaseOrderLineItem[]
}

const route = useRoute()
const orderId = computed(() => String(route.params.id))
const editOpen = ref(false)
const submitOpen = ref(false)
const receiptOpen = ref(false)
const itemModalOpen = ref(false)
const editingItem = ref<PurchaseOrderLineItem | null>(null)
const { loadDictionaries, getLabel } = useAssetLabels()
await loadDictionaries()
const { data: response, refresh, error } = await useFetch<ApiResponse<PurchaseOrderDetail>>(() => `/api/v1/purchase-orders/${orderId.value}`)

if (error.value?.statusCode === 404) {
  throw createError({ statusCode: 404, message: '采购单不存在' })
}

const order = computed(() => response.value?.data)
const orderStatusLabel = computed(() => getLabel('purchase_status', order.value?.status))
const purchaseTypeLabel = computed(() => getLabel('purchase_type', order.value?.purchase_type))
const purposeTypeLabel = computed(() => getLabel('purchase_purpose_type', order.value?.purpose_type))
const displayOrderItems = computed(() => (order.value?.items || []).map(item => ({
  ...item,
  asset_category_label: getLabel('asset_category', item.asset_category),
  target_type_label: ({
    none: '不指定',
    user: '用户',
    dept: '部门',
    project: '项目',
    environment: '环境',
    system: '系统'
  } as Record<string, string>)[item.target_type] || item.target_type
})))

const itemColumns = [
  { accessorKey: 'line_no', header: '行号' },
  { accessorKey: 'item_name', header: '采购内容' },
  { accessorKey: 'asset_category_label', header: '大类' },
  { accessorKey: 'specification', header: '规格' },
  { accessorKey: 'quantity', header: '数量' },
  { accessorKey: 'target_type_label', header: '目标' },
  { accessorKey: 'total_price', header: '金额' }
]

const handleRefresh = () => refresh()
const handleUpdated = async () => {
  await refresh()
}
const handleSubmitted = async () => {
  await refresh()
}
const handleReceiptCreated = async () => {
  await refresh()
}
const handleItemSaved = async () => {
  editingItem.value = null
  await refresh()
}
const handleCreateItem = () => {
  editingItem.value = null
  itemModalOpen.value = true
}
const handleSelectItem = (_event: Event, row: { original: PurchaseOrderLineItem }) => {
  editingItem.value = row.original
  itemModalOpen.value = true
}
</script>

<template>
  <UDashboardPanel id="purchase-order-detail" grow>
    <template #body>
      <Teleport to="#assets-layout-header-title">
        <h1 class="truncate text-base font-semibold">
          {{ order?.order_no || '采购单详情' }}
        </h1>
      </Teleport>
      <Teleport to="#assets-layout-header-actions">
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          to="/procurement/orders"
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
          icon="i-lucide-send"
          color="primary"
          variant="soft"
          @click="submitOpen = true"
        >
          提交审批
        </UButton>
        <UButton
          icon="i-lucide-package-plus"
          color="info"
          variant="soft"
          @click="receiptOpen = true"
        >
          新增入库记录
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

      <div v-if="order" class="p-4 space-y-4">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <span class="font-semibold">{{ order.order_no }}</span>
              <UBadge color="warning" variant="soft">
                {{ orderStatusLabel }}
              </UBadge>
            </div>
          </template>
          <div class="grid gap-3 md:grid-cols-2 text-sm">
            <div><span class="text-muted">采购类型：</span>{{ purchaseTypeLabel }}</div>
            <div><span class="text-muted">用途：</span>{{ purposeTypeLabel }}</div>
            <div><span class="text-muted">项目：</span>{{ order.project_code || '-' }}</div>
            <div><span class="text-muted">合同：</span>{{ order.contract_code || '-' }}</div>
            <div><span class="text-muted">供应商：</span>{{ order.supplier_name || '-' }}</div>
            <div><span class="text-muted">申请人：</span>{{ order.applicant_uid }}</div>
            <div><span class="text-muted">预算金额：</span>¥{{ order.budget_amount }}</div>
            <div><span class="text-muted">实际金额：</span>{{ order.actual_amount ? `¥${order.actual_amount}` : '-' }}</div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center justify-between gap-3">
              <span class="font-semibold">采购明细</span>
              <UButton
                icon="i-lucide-plus"
                size="sm"
                color="primary"
                variant="soft"
                @click="handleCreateItem"
              >
                新增明细
              </UButton>
            </div>
          </template>
          <UTable :data="displayOrderItems" :columns="itemColumns" @select="handleSelectItem" />
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <AssetsPurchaseOrderSubmitModal
    :open="submitOpen"
    :order-id="order ? order.id : null"
    :order-no="order?.order_no || null"
    @update:open="submitOpen = $event"
    @submitted="handleSubmitted"
  />

  <AssetsPurchaseOrderReceiptModal
    :open="receiptOpen"
    :order-id="order ? order.id : null"
    :order-no="order?.order_no || null"
    @update:open="receiptOpen = $event"
    @created="handleReceiptCreated"
  />

  <AssetsPurchaseOrderEditModal
    :open="editOpen"
    :order="order || null"
    @update:open="editOpen = $event"
    @updated="handleUpdated"
  />

  <AssetsPurchaseOrderItemModal
    :open="itemModalOpen"
    :order-id="order ? order.id : null"
    :item="editingItem"
    @update:open="itemModalOpen = $event"
    @saved="handleItemSaved"
  />
</template>
