<script setup lang="ts">
import { objectiveStates, objectivePositive as positive, objectiveDecimal as decimal, validProductObjective, validObjectiveMetric, type ProductObjective, type ProductObjectiveObservationView as Observation } from '~/utils/productObjectiveView'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '目标详情', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const saving = ref(false)
const canCorrect = ref(false)
const objectiveActions = useTemplateRef('objectiveActions')
const code = computed(() => String(route.params.productCode || ''))
const id = computed(() => String(route.params.objectiveId || ''))
const base = computed(() => `/api/v1/products/${encodeURIComponent(code.value)}/objectives/${encodeURIComponent(id.value)}`)
const { data, status, error, refresh } = await useFetch(base, { server: false, transform: (response: { code: number, data: { objective: ProductObjective, workspace_revision: number } }) => {
  if (response.code !== 0 || !response.data || !positive(response.data.workspace_revision) || !validProductObjective(response.data.objective, code.value) || String(response.data.objective.id) !== id.value) throw new Error('目标详情响应不完整')
  return response.data
} })

interface History { items: Observation[], total: number, page: number, pageSize: number, objective_id: number, workspace_revision: number }
const { page, pageSize } = useListPage({ pageSize: 10 })
const { data: history, status: historyStatus, error: historyError, refresh: refreshHistory } = await useFetch(() => `${base.value}/observations`, { server: false, query: computed(() => ({ page: page.value, pageSize })), transform: (response: { code: number, data: History }) => {
  const result = response.data
  if (response.code !== 0 || !result || String(result.objective_id) !== id.value || !positive(result.workspace_revision) || !Array.isArray(result.items) || !Number.isSafeInteger(result.total) || result.total < 0 || result.page !== page.value || result.pageSize !== pageSize || result.items.length > pageSize || result.items.length > result.total || new Set(result.items.map(item => item.id)).size !== result.items.length || result.items.some(item => (item.correction_of_id !== null && !positive(item.correction_of_id)) || (item.superseded_by_id !== null && !positive(item.superseded_by_id)) || typeof item.correction_reason !== 'string' || (item.correction_of_id !== null && !item.correction_reason.trim()) || !positive(item.id) || !positive(item.objective_revision) || item.product_code !== code.value || String(item.objective_id) !== id.value || !item.biz_id || !validObjectiveMetric(item.metric_snapshot) || !decimal(item.measured_value) || (item.attainment_percent !== null && (typeof item.attainment_percent !== 'string' || !/^-?\d+\.\d{6}$/.test(item.attainment_percent))) || !/^\d{4}-\d{2}-\d{2}$/.test(item.observed_on) || typeof item.evidence !== 'string' || !item.evidence.trim() || typeof item.note !== 'string' || typeof item.created_by !== 'string' || !item.created_by || typeof item.created_at !== 'string')) throw new Error('目标观测历史响应不完整')
  return result
} })
const alert = useApiErrorAlert(error, { fallbackTitle: '目标详情加载失败' })
const historyAlert = useApiErrorAlert(historyError, { fallbackTitle: '目标观测历史加载失败' })
async function reload() {
  await Promise.all([refresh(), refreshHistory()])
}
onBeforeRouteLeave(() => !saving.value)
onBeforeRouteUpdate(() => !saving.value)
</script>

<template>
  <div class="mx-auto min-w-0 max-w-5xl space-y-4 p-4 sm:p-6">
    <div class="flex flex-wrap justify-between gap-3">
      <UButton
        :to="`/products/${encodeURIComponent(code)}/objectives`"
        color="neutral"
        variant="ghost"
        icon="i-lucide-arrow-left"
      >
        返回产品目标
      </UButton>
      <UButton
        color="neutral"
        variant="outline"
        :loading="status === 'pending' || historyStatus === 'pending'"
        :disabled="saving"
        @click="reload()"
      >
        刷新
      </UButton>
    </div>
    <UAlert v-if="alert" v-bind="alert" />
    <p v-if="status === 'pending'" role="status">
      正在加载目标…
    </p>
    <UCard v-if="status === 'success' && data">
      <div class="flex flex-wrap items-start justify-between gap-2">
        <h1 class="min-w-0 flex-1 break-words text-lg font-semibold">
          {{ data.objective.title }}
        </h1>
        <UBadge color="neutral">
          {{ objectiveStates[data.objective.status] }}
        </UBadge>
      </div>
      <p class="mt-2 text-sm text-muted">
        {{ data.objective.starts_on }} 至 {{ data.objective.ends_on }}
      </p>
      <p class="mt-3 whitespace-pre-wrap break-words">
        {{ data.objective.description }}
      </p>
      <dl class="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt class="text-muted">
            衡量指标
          </dt><dd class="break-words">
            {{ data.objective.metric.name }}（{{ data.objective.metric.unit }}）
          </dd>
        </div>
        <div>
          <dt class="text-muted">
            基线值
          </dt><dd class="break-all">
            {{ data.objective.metric.baseline_value }}
          </dd>
        </div>
        <div>
          <dt class="text-muted">
            {{ data.objective.metric.direction === 'increase' ? '提高至' : '降低至' }}
          </dt><dd class="break-all">
            {{ data.objective.metric.target_value }}
          </dd>
        </div>
      </dl>
      <p class="mt-3 whitespace-pre-wrap break-words text-sm">
        测量口径：{{ data.objective.metric.measurement_definition }}
      </p>
    </UCard>
    <ProductsObjectiveActions
      v-if="status === 'success' && data"
      ref="objectiveActions"
      :key="`${code}:${id}`"
      :objective="data.objective"
      :workspace-revision="data.workspace_revision"
      @busy="saving = $event"
      @can-correct="canCorrect = $event"
      @saved="reload()"
    />
    <ProductsObjectiveItems
      v-if="status === 'success' && data"
      :key="`${code}:${id}:items`"
      :product-code="code"
      :objective-id="data.objective.id"
      :objective-status="data.objective.status"
      :workspace-revision="data.workspace_revision"
      :disabled="saving"
      @busy="saving = $event"
      @saved="reload()"
    />
    <ProductsObjectiveCycles
      v-if="status === 'success' && data"
      :key="`${code}:${id}:cycles`"
      :product-code="code"
      :objective-id="data.objective.id"
      :objective-status="data.objective.status"
      :workspace-revision="data.workspace_revision"
      :disabled="saving"
      @busy="saving = $event"
      @saved="reload()"
    />
    <section v-if="status === 'success' && data" class="space-y-3" aria-label="目标观测历史">
      <h2 class="font-semibold">
        观测历史
      </h2>
      <p class="text-sm text-muted">
        达成率按每条观测保存的基线和目标值计算。负值表示退步，超过 100% 表示超额达成。
      </p>
      <UAlert v-if="historyAlert" v-bind="historyAlert" />
      <p v-if="historyStatus === 'pending'" role="status">
        正在加载观测…
      </p>
      <template v-else-if="historyStatus === 'success' && history">
        <CommonEmptyState
          v-if="!history.total"
          icon="i-lucide-chart-no-axes-combined"
          title="尚无指标观测"
          description="未录入实际结果，目标达成情况未知。"
        />
        <UCard v-for="observation in history.items" :key="observation.biz_id" as="article">
          <h3 class="font-medium">
            {{ observation.observed_on }} · {{ observation.metric_snapshot.name }}
          </h3>
          <div class="mt-2 flex flex-wrap gap-2">
            <UBadge v-if="observation.superseded_by_id !== null" color="warning" variant="subtle">
              已被更正 · 保留历史
            </UBadge>
            <UBadge v-else color="neutral" variant="subtle">
              未被更正
            </UBadge>
            <UBadge v-if="observation.correction_of_id !== null" color="neutral" variant="outline">
              更正记录
            </UBadge>
          </div>
          <p v-if="observation.correction_reason" class="mt-2 whitespace-pre-wrap break-words text-sm">
            更正原因：{{ observation.correction_reason }}
          </p>
          <UButton
            v-if="canCorrect && observation.superseded_by_id === null"
            :disabled="saving"
            variant="outline"
            color="neutral"
            class="mt-2"
            @click="objectiveActions?.correct(observation)"
          >
            更正观测
          </UButton>
          <dl class="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt class="text-muted">
                实测值（{{ observation.metric_snapshot.unit }}）
              </dt><dd class="break-all">
                {{ observation.measured_value }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                目标达成率
              </dt><dd class="break-all">
                {{ observation.attainment_percent === null ? '未知' : `${observation.attainment_percent}%` }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                当时基线
              </dt><dd class="break-all">
                {{ observation.metric_snapshot.baseline_value }}
              </dd>
            </div>
            <div>
              <dt class="text-muted">
                当时目标
              </dt><dd class="break-all">
                {{ observation.metric_snapshot.target_value }}
              </dd>
            </div>
          </dl>
          <p class="mt-3 whitespace-pre-wrap break-words text-sm">
            口径：{{ observation.metric_snapshot.measurement_definition }}
          </p>
          <p class="mt-3 whitespace-pre-wrap break-words text-sm">
            证据：{{ observation.evidence }}
          </p>
          <p v-if="observation.note" class="mt-2 whitespace-pre-wrap break-words text-sm text-muted">
            备注：{{ observation.note }}
          </p>
        </UCard>
        <div class="flex flex-wrap items-center justify-between gap-3">
          <p class="text-sm text-muted">
            共 {{ history.total }} 条观测
          </p>
          <UPagination
            v-model:page="page"
            :items-per-page="pageSize"
            :total="history.total"
            :sibling-count="1"
          />
        </div>
      </template>
    </section>
  </div>
</template>
