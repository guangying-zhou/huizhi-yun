<script setup lang="ts">
import { getProductPerspectives, productNavTo, type ProductPerspectiveKey } from '~/config/productNavigation'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '产品概览', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const { product, workspaceStatus, workspaceError, permissions, permissionStatus, permissionError, refreshAll } = useProductWorkspace(code)
const errorAlert = useApiErrorAlert(workspaceError, { fallbackTitle: '产品空间加载失败' })
const permissionAlert = useApiErrorAlert(permissionError, { fallbackTitle: '操作权限加载失败' })
const canEdit = computed(() => permissionStatus.value === 'success' && permissions.value?.edit === true && product.value?.status === 'active')

/**
 * 概览指标只做计数：每个入口取列表接口的第一页 total。
 * 单个入口无权限或读取失败时按「—」呈现，不阻塞整页，也不用 0 冒充未知。
 */
const { data: metrics, status: metricsStatus, refresh: refreshMetrics } = await useAsyncData(() => `product-overview-metrics:${code.value}`, async () => {
  const productCode = code.value
  if (!productCode) return null
  const base = `/api/v1/products/${encodeURIComponent(productCode)}`
  async function readCount(path: string, query: Record<string, unknown>, pick: (data: Record<string, unknown>) => unknown) {
    try {
      const response = await $fetch<{ code: number, data: Record<string, unknown> }>(`${base}${path}`, { query, timeout: 15000 })
      if (response.code !== 0 || !response.data) return null
      const value = pick(response.data)
      return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
    } catch {
      return null
    }
  }
  const [features, versions, pendingRequests, objectives, customers] = await Promise.all([
    readCount('/features', { page: 1, pageSize: 1 }, data => data.total),
    readCount('/versions', { page: 1, pageSize: 1 }, data => data.total),
    readCount('/requests', { page: 1, pageSize: 1, decisionStatus: 'submitted' }, data => data.total),
    readCount('/objectives', { page: 1, pageSize: 1 }, data => data.total),
    readCount('/roadmaps/adoption', { page: 1, pageSize: 1 }, data => (data.summary as { customers?: unknown } | undefined)?.customers)
  ])
  return { features, versions, pendingRequests, objectives, customers }
}, { server: false, watch: [code] })

function metricText(value: number | null | undefined) {
  return typeof value === 'number' ? String(value) : '—'
}

const perspectives = computed(() => getProductPerspectives(code.value))
const workPerspectives = computed(() => perspectives.value
  .filter(item => item.key !== 'overview' && item.key !== 'settings')
  .map(item => ({
    ...item,
    to: productNavTo(perspectives.value, item.key, item.path),
    highlights: perspectiveHighlights(item.key)
  })))

function perspectiveHighlights(key: ProductPerspectiveKey) {
  const value = metrics.value
  if (key === 'rd') {
    return [{ label: '需求待评估', value: metricText(value?.pendingRequests) }, { label: '版本计划', value: metricText(value?.versions) }, { label: '产品功能', value: metricText(value?.features) }]
  }
  if (key === 'gtm') {
    return [{ label: '采用客户', value: metricText(value?.customers) }, { label: '版本', value: metricText(value?.versions) }]
  }
  return [{ label: '产品目标', value: metricText(value?.objectives) }]
}

const summaryCards = computed(() => [
  { label: '需求待评估', value: metricText(metrics.value?.pendingRequests), hint: '等待产品评审' },
  { label: '版本计划', value: metricText(metrics.value?.versions), hint: '含规划与已发布' },
  { label: '产品功能', value: metricText(metrics.value?.features), hint: '按模块维护的长期能力' },
  { label: '采用客户', value: metricText(metrics.value?.customers), hint: '已登记部署客户' }
])

const positioningFields = [
  { key: 'positioning' as const, label: '产品定位' },
  { key: 'target_users' as const, label: '目标用户' },
  { key: 'value_statement' as const, label: '核心价值' }
]

const { setRefresh, clearRefresh } = usePageActions()
onMounted(() => setRefresh(async () => {
  await Promise.all([refreshAll(), refreshMetrics()])
}))
onBeforeUnmount(clearRefresh)
</script>

<template>
  <div class="min-w-0 space-y-6 p-4 sm:p-6">
    <UAlert v-if="errorAlert" v-bind="errorAlert" />
    <UAlert v-if="permissionAlert" v-bind="permissionAlert" />
    <div
      v-if="workspaceStatus === 'pending' && !product"
      role="status"
      aria-live="polite"
      class="py-12 text-center text-sm text-muted"
    >
      正在加载产品空间…
    </div>

    <template v-else-if="product">
      <UAlert
        v-if="product.status === 'archived'"
        color="warning"
        variant="soft"
        icon="i-lucide-archive"
        title="产品空间已归档"
        description="归档后仅供查看。需要继续维护时，请由产品负责人在设置中恢复。"
      />

      <!-- 关键计数 -->
      <div class="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <UPageCard
          v-for="card in summaryCards"
          :key="card.label"
          spotlight
          variant="outline"
          :ui="{ container: 'gap-y-2 sm:px-6 sm:py-4' }"
        >
          <div class="space-y-1">
            <p class="text-xs font-semibold uppercase tracking-widest text-muted">
              {{ card.label }}
            </p>
            <div class="flex items-baseline gap-2">
              <span class="text-2xl font-bold">{{ card.value }}</span>
              <span class="truncate text-xs text-muted">{{ card.hint }}</span>
            </div>
          </div>
        </UPageCard>
      </div>
      <p v-if="metricsStatus === 'success'" class="text-xs text-muted">
        显示为「—」表示当前账号无权读取该数据或读取失败，可使用页面刷新重试。
      </p>

      <!-- 工作视角 -->
      <section class="space-y-3">
        <div>
          <h2 class="text-base font-semibold">
            工作视角
          </h2>
          <p class="mt-1 text-sm text-muted">
            产品与研发从需求池开始：整理需求、排入版本、确认计划，再跟踪研发交付。销售与经营岗位可进入对应视角查看。
          </p>
        </div>
        <div class="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <UPageCard
            v-for="perspective in workPerspectives"
            :key="perspective.key"
            spotlight
            variant="outline"
            :ui="{ container: 'gap-y-3 sm:px-6 sm:py-5' }"
          >
            <div class="flex min-w-0 flex-col gap-3">
              <div class="flex items-center gap-2">
                <UIcon :name="perspective.icon" class="size-5 shrink-0 text-primary" />
                <h3 class="truncate text-sm font-semibold text-highlighted">
                  {{ perspective.label }}
                </h3>
              </div>
              <div class="space-y-1 text-sm">
                <p class="text-muted">
                  <span class="text-dimmed">主要面向：</span>{{ perspective.audience }}
                </p>
                <p class="text-muted">
                  <span class="text-dimmed">优先呈现：</span>{{ perspective.summary }}
                </p>
              </div>
              <div class="flex flex-wrap gap-x-4 gap-y-1">
                <div v-for="highlight in perspective.highlights" :key="highlight.label" class="flex items-baseline gap-1.5">
                  <span class="text-lg font-semibold">{{ highlight.value }}</span>
                  <span class="text-xs text-muted">{{ highlight.label }}</span>
                </div>
              </div>
              <div class="flex flex-wrap gap-1.5">
                <UButton
                  v-for="item in perspective.items"
                  :key="item.path"
                  :to="productNavTo(perspectives, perspective.key, item.path)"
                  :label="item.label"
                  :icon="item.icon"
                  size="xs"
                  color="neutral"
                  variant="soft"
                />
              </div>
              <UButton
                :to="perspective.to"
                trailing-icon="i-lucide-arrow-right"
                variant="link"
                class="self-start px-0"
              >
                进入{{ perspective.label }}
              </UButton>
            </div>
          </UPageCard>
        </div>
      </section>

      <!-- 产品定位 -->
      <section class="space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-base font-semibold">
            产品定位
          </h2>
          <UButton
            v-if="canEdit"
            :to="`/products/${encodeURIComponent(code)}/settings`"
            icon="i-lucide-pencil"
            color="neutral"
            variant="outline"
            size="sm"
          >
            维护产品信息
          </UButton>
        </div>
        <dl class="divide-y divide-default rounded-lg border border-default px-4">
          <div v-for="field in positioningFields" :key="field.key" class="space-y-2 py-4">
            <dt class="text-sm font-medium">
              {{ field.label }}
            </dt>
            <dd class="whitespace-pre-wrap break-words text-sm text-muted">
              {{ product[field.key] || '尚未填写' }}
            </dd>
          </div>
        </dl>
      </section>
    </template>
  </div>
</template>
