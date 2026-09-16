<script setup lang="ts">
import { objectivePositive as positive } from '~/utils/productObjectiveView'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '承诺历史', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
const id = computed(() => String(route.params.itemId || ''))
const page = ref(1), pageSize = 20
const expanded = ref<string | null>(null)
const reasons: Record<string, string> = { scope_changed: '范围已变化', evidence_changed: '证据已变化', window_changed: '探索窗口已变化', model_changed: '评分模型已变化', decision_changed: '选入决定或评估已变化', queue_changed: '决定顺序已变化', lifecycle_changed: '事项状态已变化', dependencies_changed: '前置依赖已变化', dependency_snapshot_missing: '缺少原依赖快照', cross_dependency_snapshot_missing: '缺少跨产品依赖状态依据', cross_dependencies_changed: '跨产品前置事项或依赖关系已变化' }
interface Baseline { id: number, biz_id: string, starts_on: string, ends_on: string, reason: string, created_by: string, created_at: string, requires_review: boolean, review_reasons: string[], item_snapshot: { biz_id: string, product_code: string, title: string, scope_summary: string, previous_commitment_id: number } }
interface History { items: Baseline[], total: number, page: number, pageSize: number, item_biz_id: string, latest_id: number, workspace_revision: number, item_revision: number }
watch([code, id], () => {
  page.value = 1
  expanded.value = null
})
const { data, status, error, refresh } = await useFetch(() => `/api/v1/products/${encodeURIComponent(code.value)}/roadmaps/commitments/${encodeURIComponent(id.value)}`, {
  server: false, query: computed(() => ({ page: page.value, pageSize })), transform: (response: { code: number, data: History }) => {
    const value = response.data
    if (response.code !== 0 || !value || value.item_biz_id !== id.value || value.page !== page.value || value.pageSize !== pageSize || !positive(value.workspace_revision) || !positive(value.item_revision) || !Number.isSafeInteger(value.total) || value.total < 0 || !Number.isSafeInteger(value.latest_id) || value.latest_id < 0 || (value.total === 0) !== (value.latest_id === 0) || !Array.isArray(value.items) || value.items.length > pageSize || value.items.length > value.total || new Set(value.items.map(item => item?.id)).size !== value.items.length || value.items.some(item => !item || !positive(item.id) || item.id > value.latest_id || !item.item_snapshot || item.item_snapshot.biz_id !== id.value || item.item_snapshot.product_code !== code.value || typeof item.item_snapshot.title !== 'string' || typeof item.item_snapshot.scope_summary !== 'string' || typeof item.reason !== 'string' || typeof item.created_by !== 'string' || typeof item.created_at !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.starts_on) || !/^\d{4}-\d{2}-\d{2}$/.test(item.ends_on) || item.ends_on < item.starts_on || typeof item.requires_review !== 'boolean' || !Array.isArray(item.review_reasons) || item.review_reasons.some(reason => typeof reason !== 'string') || item.requires_review !== (item.review_reasons.length > 0))) throw new Error('承诺历史响应不完整')
    return value
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '承诺历史加载失败' })
</script>

<template>
  <div class="mx-auto min-w-0 max-w-4xl space-y-4 p-4 sm:p-6">
    <UButton :to="`/products/${encodeURIComponent(code)}/planning-items/${encodeURIComponent(id)}/roadmap`" color="neutral" variant="ghost">
      返回探索窗口
    </UButton>
    <h1 class="text-xl font-semibold">
      承诺历史
    </h1>
    <p class="text-sm text-muted">
      保存每次确认时的范围和时间窗口。复评提示反映当前事实变化，原承诺不会自动撤销或改写。
    </p>
    <UButton
      color="neutral"
      variant="outline"
      :loading="status === 'pending'"
      @click="refresh()"
    >
      刷新历史
    </UButton>
    <UAlert v-if="alert" v-bind="alert" />
    <p v-if="status === 'pending'" role="status">
      正在加载承诺历史…
    </p>
    <template v-else-if="status === 'success' && data">
      <p class="text-sm text-muted">
        共 {{ data.total }} 条基线
      </p>
      <UCard v-if="!data.items.length">
        <p>暂无承诺记录。</p>
      </UCard>
      <ol v-else class="space-y-4">
        <li v-for="item in data.items" :key="item.id">
          <UCard>
            <div class="flex flex-wrap items-center justify-between gap-2">
              <h2 class="break-words font-semibold">
                {{ item.item_snapshot.title }}
              </h2>
              <UBadge :color="item.id === data.latest_id ? 'primary' : 'neutral'" variant="subtle">
                {{ item.id === data.latest_id ? '最新基线' : '历史基线' }}
              </UBadge>
            </div>
            <p class="mt-3 font-medium">
              {{ item.starts_on }} 至 {{ item.ends_on }}
            </p>
            <p class="mt-2 whitespace-pre-wrap break-words text-sm">
              {{ item.item_snapshot.scope_summary }}
            </p>
            <p class="mt-2 whitespace-pre-wrap break-words text-sm">
              确认原因：{{ item.reason }}
            </p>
            <p class="mt-2 break-words text-sm text-muted">
              确认人：{{ item.created_by }} · {{ item.created_at }}
            </p>
            <div v-if="item.requires_review" class="mt-3 space-y-2">
              <p class="text-sm font-medium text-warning">
                需要复评
              </p>
              <ul class="list-disc pl-5 text-sm">
                <li v-for="reason in item.review_reasons" :key="reason">
                  {{ reasons[reason] || '其他事实已变化，请重新核对' }}
                </li>
              </ul>
            </div>
            <p v-else class="mt-3 text-sm text-muted">
              当前未检测到需复评的变化。
            </p>
            <UButton
              class="mt-3"
              color="neutral"
              variant="outline"
              :aria-expanded="expanded === item.biz_id"
              @click="expanded = expanded === item.biz_id ? null : item.biz_id"
            >
              {{ expanded === item.biz_id ? '收起前置历史' : '查看前置历史' }}
            </UButton>
            <ProductsRoadmapCrossHistory
              v-if="expanded === item.biz_id"
              :key="item.biz_id"
              :product-code="code"
              :item-id="id"
              :commitment-id="item.biz_id"
            />
          </UCard>
        </li>
      </ol>
      <UPagination
        v-if="data.total > pageSize"
        v-model:page="page"
        :items-per-page="pageSize"
        :total="data.total"
      />
    </template>
  </div>
</template>
