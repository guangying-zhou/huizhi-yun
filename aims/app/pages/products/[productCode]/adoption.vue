<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { ProductAdoptionInstance, ProductAdoptionPage } from '~/types/productAdoption'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '产品采用', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const page = ref(1)
watch(code, () => {
  page.value = 1
})
const { data, status, error, refresh } = await useAsyncData(() => `product-adoption:${code.value}:${page.value}`, async () => {
  const product = code.value, requestedPage = page.value
  const response = await $fetch<{ code: number, data: ProductAdoptionPage }, string>(`/api/v1/products/${encodeURIComponent(product)}/roadmaps/adoption`, { query: { page: requestedPage, pageSize: 20 }, retry: 0, timeout: 30000 })
  if (response.code !== 0 || response.data?.productCode !== product || response.data.page !== requestedPage) throw new Error('采用查询响应不一致')
  return response.data
}, { server: false })
const current = computed(() => status.value === 'success' && data.value?.productCode === code.value && data.value.page === page.value ? data.value : null)
const alert = useApiErrorAlert(error, { fallbackTitle: '产品采用读取失败' })
// Assets 明确拒绝这位用户的对象范围时给出可执行提示；服务授权或部署绑定问题
// 由服务端保持 503，不在这里提示用户去申请权限。
const scopeDenied = computed(() => {
  const body = error.value && typeof error.value === 'object' ? (error.value as { data?: { data?: { reason?: unknown } } }).data : null
  return body?.data?.reason === 'assets_object_scope_denied'
})
const metrics = computed(() => current.value
  ? [
      { label: '采用实例', value: current.value.summary.instances },
      { label: '采用环境', value: current.value.summary.environments },
      { label: '采用客户', value: current.value.summary.customers },
      { label: '生产实例', value: current.value.summary.productionInstances },
      { label: '版本未知', value: current.value.summary.unknownVersionInstances },
      { label: '版本冲突', value: current.value.summary.conflictingVersionInstances }
    ]
  : [])
const roles: Record<string, string> = { primary: '主环境', test: '测试', production: '生产', backup: '备份', disaster_recovery: '容灾', training: '培训', other: '其他' }
const states: Record<string, string> = { planned: '规划中', provisioning: '准备中', deployed: '已部署', online: '已上线', accepted: '已验收', suspended: '已暂停', removed: '已移除' }
const columns: TableColumn<ProductAdoptionInstance>[] = [{ id: 'instance', header: '交付资产 / 环境' }, { id: 'customer', header: '客户编码' }, { id: 'roles', header: '环境角色' }, { id: 'status', header: '部署状态' }, { id: 'version', header: '实际部署版本' }]
</script>

<template>
  <div class="mx-auto min-w-0 max-w-6xl space-y-4 p-4 sm:p-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0">
        <h1 class="text-xl font-semibold">
          产品采用
        </h1>
        <p class="mt-1 text-sm text-muted">
          当前有权查看的交付资产与环境。按资产和环境组合去重，统计已部署、已上线或已验收的实例。
        </p>
      </div>
      <UButton
        color="neutral"
        variant="outline"
        icon="i-lucide-refresh-cw"
        :loading="status === 'pending'"
        @click="refresh()"
      >
        刷新采用数据
      </UButton>
    </div>
    <UAlert
      v-if="scopeDenied"
      color="warning"
      variant="subtle"
      icon="i-lucide-shield-alert"
      title="需要 Assets 交付资产与环境的查看范围"
      description="产品采用按当前登录用户在 Assets 的数据范围过滤。请为该用户配置 Assets deliveries:view 与 environments:view，并确认数据范围覆盖相关交付资产和环境；仅有 Aims 产品权限不足以查看本页。"
    />
    <UAlert v-else-if="alert" v-bind="alert" />
    <div v-if="current" class="grid grid-cols-2 gap-3 lg:grid-cols-6">
      <UCard v-for="metric in metrics" :key="metric.label">
        <p class="text-sm text-muted">
          {{ metric.label }}
        </p><p class="mt-1 text-2xl font-semibold tabular-nums">
          {{ metric.value }}
        </p>
      </UCard>
    </div>
    <UAlert
      color="info"
      variant="subtle"
      icon="i-lucide-info"
      title="实际部署与产品发布分别记录"
      description="发布版本不代表客户已经部署。未知版本保留原状；同一实例记录多个版本时标记冲突。当前快照不提供历史趋势。"
    />
    <p v-if="current" class="text-xs text-muted break-all">
      查询时间：{{ current.queriedAt }}
    </p>
    <p class="text-xs text-muted sm:hidden">
      表格可左右滑动查看完整信息。
    </p>
    <div class="overflow-x-auto">
      <UTable
        :data="current?.items || []"
        :columns="columns"
        :loading="status === 'pending'"
        class="min-w-[720px]"
      >
        <template #instance-cell="{ row }">
          <div class="max-w-56 whitespace-normal break-all">
            <p class="font-medium">
              {{ row.original.deliveryAssetCode }}
            </p><p class="text-xs text-muted">
              {{ row.original.environmentCode }}
            </p>
          </div>
        </template>
        <template #customer-cell="{ row }">
          <span class="block max-w-40 whitespace-normal break-all">{{ row.original.customerCode || '未关联客户' }}</span>
        </template>
        <template #roles-cell="{ row }">
          <div class="flex max-w-40 flex-wrap gap-1">
            <UBadge
              v-for="role in row.original.roles"
              :key="role"
              color="neutral"
              variant="subtle"
            >
              {{ roles[role] || role }}
            </UBadge>
          </div>
        </template>
        <template #status-cell="{ row }">
          <div class="max-w-40 space-y-1 whitespace-normal">
            <p>{{ row.original.deploymentStatuses.map(value => states[value] || value).join('、') }}</p><UBadge :color="row.original.adopted ? 'success' : 'neutral'" variant="subtle">
              {{ row.original.adopted ? '计入采用' : '未计入采用' }}
            </UBadge>
          </div>
        </template>
        <template #version-cell="{ row }">
          <div class="max-w-56 space-y-1 whitespace-normal break-all">
            <p>{{ row.original.versions.join('、') || '—' }}</p><div class="flex flex-wrap gap-1">
              <UBadge v-if="row.original.versionUnknown" color="warning" variant="subtle">
                版本未知
              </UBadge><UBadge v-if="row.original.versionConflict" color="error" variant="subtle">
                版本冲突
              </UBadge>
            </div>
          </div>
        </template>
        <template #empty>
          <CommonEmptyState icon="i-lucide-boxes" title="暂无可见部署实例" description="请确认交付资产已关联环境，并具有相应查看权限。" />
        </template>
      </UTable>
    </div>
    <div v-if="current" class="flex flex-wrap items-center justify-between gap-3">
      <span class="text-sm text-muted">共 {{ current.total }} 个有效关联实例（含未采用）</span>
      <UPagination
        v-model:page="page"
        :items-per-page="20"
        :total="current.total"
        :sibling-count="1"
      />
    </div>
  </div>
</template>
