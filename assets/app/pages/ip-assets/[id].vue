<script setup lang="ts">
import type { ApiResponse, IpAssetItem, IpLinkedProduct } from '~/types'
import { useAssetsModule } from '../../../layer/useAssetsModule'
import { useAssetLabels } from '../../composables/useAssetLabels'

const route = useRoute()
const assetId = computed(() => String(route.params.id))
const editOpen = ref(false)
const linkProductOpen = ref(false)
const documentOpen = ref(false)
const { hosted, moduleUrl, cacheKey } = useAssetsModule()
const { loadPermissions, hasPermission, loaded: permissionsLoaded } = usePermissions()
const { data: writeAccess } = await useFetch<ApiResponse<{ digital_assets: boolean, ip_assets: boolean, ip_assets_link_product: boolean }>>(moduleUrl('/api/v1/write-access'), {
  key: cacheKey('assets-write-access'),
  immediate: hosted
})
if (!hosted) await loadPermissions()
const canEditIpAsset = computed(() => hosted
  ? writeAccess.value?.data?.ip_assets === true
  : permissionsLoaded.value && hasPermission('ip_assets', 'edit'))
const canLinkProduct = computed(() => hosted
  ? writeAccess.value?.data?.ip_assets_link_product === true
  : canEditIpAsset.value)
const { loadDictionaries, getLabel } = useAssetLabels()
await loadDictionaries()
const { data: response, refresh, error } = await useFetch<ApiResponse<IpAssetItem>>(() => moduleUrl(`/api/v1/ip-assets/${assetId.value}`), {
  key: cacheKey(`ip-asset:${assetId.value}`)
})
const { data: productResponse, error: productError, refresh: refreshProducts } = await useFetch<ApiResponse<{ id: number, items: IpLinkedProduct[], total: number }>>(() => moduleUrl(`/api/v1/ip-assets/${assetId.value}/products`), {
  key: cacheKey(`ip-asset-products:${assetId.value}`),
  immediate: hosted
})

if (!hosted && error.value?.statusCode === 404) {
  throw createError({ statusCode: 404, message: '知识产权资产不存在' })
}

const asset = computed(() => response.value?.data)
usePageTitle(computed(() => asset.value?.ip_name || '知识产权详情'))
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
const linkedProducts = computed(() => (hosted ? productResponse.value?.data?.items || [] : asset.value?.linked_products || []).map(item => ({
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

const handleRefresh = async () => {
  await Promise.all([refresh(), ...(hosted ? [refreshProducts()] : [])])
}
const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(handleRefresh))
onBeforeUnmount(clearRefresh)
const handleUpdated = async () => {
  await handleRefresh()
}
</script>

<template>
  <UDashboardPanel id="ip-asset-detail" grow>
    <template #body>
      <div class="p-4 space-y-4">
        <p v-if="hosted && !asset && !error" role="status" class="text-sm text-muted">
          正在加载知识产权资产…
        </p>
        <UAlert
          v-if="hosted && !asset && error"
          color="error"
          variant="soft"
          :title="error.statusCode === 404 ? '知识产权资产不存在或无权查看' : '知识产权资产暂不可用'"
          description="请返回台账或重试。"
        />
        <UButton
          v-if="hosted && !asset && error"
          color="neutral"
          variant="outline"
          @click="refresh()"
        >
          重试
        </UButton>
        <UCard v-if="asset">
          <template #header>
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div class="flex min-w-0 items-center gap-2">
                <span class="truncate font-semibold">{{ asset.ip_code }}</span>
                <UBadge color="warning" variant="soft" class="shrink-0">
                  {{ statusLabel }}
                </UBadge>
              </div>
              <div class="flex flex-wrap items-center gap-2 lg:justify-end">
                <UButton
                  icon="i-lucide-arrow-left"
                  color="neutral"
                  variant="ghost"
                  :to="moduleUrl('/ip-assets')"
                >
                  返回
                </UButton>
                <UButton
                  v-if="!hosted || canEditIpAsset"
                  icon="i-lucide-pencil"
                  color="primary"
                  variant="soft"
                  @click="editOpen = true"
                >
                  编辑
                </UButton>
                <UButton
                  v-if="canLinkProduct"
                  icon="i-lucide-link-2"
                  color="primary"
                  variant="soft"
                  @click="linkProductOpen = true"
                >
                  关联产品
                </UButton>
                <UButton
                  v-if="!hosted && canEditIpAsset"
                  icon="i-lucide-file-text"
                  color="primary"
                  variant="soft"
                  @click="documentOpen = true"
                >
                  关联文档
                </UButton>
              </div>
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
            <div v-if="!hosted">
              <span class="text-muted">关联产品数：</span>{{ asset.product_count }}
            </div>
          </div>
          <p class="mt-4 text-sm text-muted">
            {{ asset.notes || '暂无备注' }}
          </p>
        </UCard>

        <UAlert
          v-if="asset && hosted && productError"
          color="error"
          variant="soft"
          icon="i-lucide-circle-alert"
          title="关联产品加载失败"
          description="请刷新后重试。"
        />
        <UAlert
          v-if="asset && hosted"
          color="info"
          variant="soft"
          icon="i-lucide-info"
          title="关联文档尚未加载"
          description="当前 Host 暂不展示关联文档明细。"
        />

        <UCard v-if="asset && (!hosted || (productResponse?.code === 0 && productResponse.data?.id === Number(assetId) && Array.isArray(productResponse.data.items)))">
          <template #header>
            <span class="font-semibold">关联产品</span>
          </template>
          <div class="space-y-3 sm:hidden">
            <article v-for="product in linkedProducts" :key="product.product_code" class="space-y-1 rounded-lg border border-default p-3">
              <p class="break-all font-medium">
                {{ product.product_code }}
              </p>
              <p class="break-words">
                {{ product.product_name }}
              </p>
              <p class="text-sm text-muted">
                {{ product.status_label }}
              </p>
            </article>
            <p v-if="!linkedProducts.length" class="text-sm text-muted">
              暂无关联产品
            </p>
          </div>
          <div class="hidden sm:block">
            <UTable :data="linkedProducts" :columns="productColumns" />
          </div>
        </UCard>

        <UCard v-if="asset && !hosted">
          <template #header>
            <span class="font-semibold">关联文档</span>
          </template>
          <UTable :data="documentItems" :columns="documentColumns" />
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <AssetsIpAssetEditModal
    v-if="!hosted || canEditIpAsset"
    :open="editOpen"
    :asset="asset || null"
    @update:open="editOpen = $event"
    @updated="handleUpdated"
  />
  <AssetsIpAssetProductLinkModal
    v-if="canLinkProduct"
    :open="linkProductOpen"
    :asset="asset || null"
    @update:open="linkProductOpen = $event"
    @created="handleUpdated"
  />
  <AssetsIpAssetDocumentLinkModal
    v-if="!hosted && canEditIpAsset"
    :open="documentOpen"
    :asset="asset || null"
    @update:open="documentOpen = $event"
    @created="handleUpdated"
  />
</template>
