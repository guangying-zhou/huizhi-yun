<script setup lang="ts">
import type { ApiResponse, CustomerDeliveryAssetItem } from '~/types'

const route = useRoute()
const assetCode = computed(() => String(route.params.code || '').trim())
const editOpen = ref(false)
const { loadPermissions, hasPermission, loaded: permissionsLoaded } = usePermissions()
const canEditDelivery = computed(() => permissionsLoaded.value && hasPermission('deliveries', 'edit'))

onMounted(() => {
  void loadPermissions()
})

const { data: response, refresh, error } = await useFetch<ApiResponse<CustomerDeliveryAssetItem>>(
  () => `/api/v1/customer-delivery-assets/${encodeURIComponent(assetCode.value)}`
)

if (error.value?.statusCode === 404) {
  throw createError({ statusCode: 404, message: '客户交付资产不存在' })
}

const asset = computed(() => response.value?.data || null)
usePageTitle(computed(() => asset.value?.product_name || '客户交付资产'))
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(refresh))
onBeforeUnmount(clearRefresh)
const deadlineItems = computed(() => [
  { label: '资产到期', value: asset.value?.expired_at || '-' },
  { label: '质保开始', value: asset.value?.warranty_start_at || '-' },
  { label: '质保结束', value: asset.value?.warranty_end_at || '-' },
  { label: '支持到期', value: asset.value?.support_expiry_at || '-' }
])
</script>

<template>
  <UDashboardPanel id="customer-delivery-asset-detail" grow>
    <template #body>
      <div class="space-y-4 p-4">
        <UAlert
          color="info"
          variant="soft"
          icon="i-lucide-shield-check"
          title="当前访问已重新授权"
          description="页面数据由 Assets 服务端按当前用户、责任人和责任部门范围实时读取，不复用通知正文或旧权限快照。"
        />
        <UCard v-if="asset">
          <template #header>
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div class="flex min-w-0 items-center gap-2">
                <span class="truncate font-semibold">{{ asset.delivery_asset_code }}</span>
                <UBadge color="warning" variant="soft" class="shrink-0">
                  {{ asset.status }}
                </UBadge>
              </div>
              <div class="flex flex-wrap items-center gap-2 lg:justify-end">
                <UButton
                  icon="i-lucide-arrow-left"
                  color="neutral"
                  variant="ghost"
                  to="/deliveries"
                >
                  返回
                </UButton>
                <UButton
                  v-if="canEditDelivery"
                  icon="i-lucide-pencil"
                  color="primary"
                  variant="soft"
                  @click="editOpen = true"
                >
                  维护责任与期限
                </UButton>
              </div>
            </div>
          </template>
          <div class="grid gap-3 text-sm md:grid-cols-2">
            <div><span class="text-muted">客户：</span>{{ asset.customer_code }}</div>
            <div><span class="text-muted">合同：</span>{{ asset.contract_code || '-' }}</div>
            <div><span class="text-muted">合同行：</span>{{ asset.contract_line_code || '-' }}</div>
            <div><span class="text-muted">项目：</span>{{ asset.project_code || '-' }}</div>
            <div><span class="text-muted">交付视图：</span>{{ asset.delivery_view_code || '-' }}</div>
            <div><span class="text-muted">产品：</span>{{ asset.product_code || asset.product_name }}</div>
            <div><span class="text-muted">运营责任人：</span>{{ asset.responsible_uid || '-' }}</div>
            <div><span class="text-muted">运营责任部门：</span>{{ asset.responsible_dept_code || '-' }}</div>
          </div>
        </UCard>
        <UCard>
          <template #header>
            <span class="font-semibold">期限事实</span>
          </template>
          <div class="grid gap-3 text-sm md:grid-cols-2">
            <div v-for="item in deadlineItems" :key="item.label">
              <span class="text-muted">{{ item.label }}：</span>{{ item.value }}
            </div>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <AssetsCustomerDeliveryAssetEditModal
    v-if="canEditDelivery"
    :open="editOpen"
    :asset="asset"
    @update:open="editOpen = $event"
    @updated="refresh()"
  />
</template>
