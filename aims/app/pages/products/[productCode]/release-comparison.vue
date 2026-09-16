<script setup lang="ts">
import { validReleaseDiff, type Diff } from '~/utils/productReleaseDiff'
import type { ProductReleaseSummary } from '~/types/productRelease'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '发布范围对比', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const code = computed(() => String(route.params.productCode || ''))
type Version = { id: number, product_code: string, version_code: string, name: string | null, status: string, revision: number }
const beforeVersion = ref<Version | null>(null), afterVersion = ref<Version | null>(null)
const beforeRelease = ref<ProductReleaseSummary | null>(null), afterRelease = ref<ProductReleaseSummary | null>(null)
const page = ref(1), data = ref<Diff | null>(null), busy = ref(false), error = ref<Error | null>(null)
const alert = useApiErrorAlert(error, { fallbackTitle: '发布对比失败' })
const ready = computed(() => beforeVersion.value && afterVersion.value && beforeRelease.value?.version_id === beforeVersion.value.id && afterRelease.value?.version_id === afterVersion.value.id)
const kinds: Record<string, string> = { added: '新增范围', removed: '移除范围', changed: '范围变更' }
watch(beforeVersion, () => {
  beforeRelease.value = null
})
watch(afterVersion, () => {
  afterRelease.value = null
})
watch([beforeRelease, afterRelease], () => {
  data.value = null
  error.value = null
  page.value = 1
})
watch(code, () => {
  beforeVersion.value = null
  afterVersion.value = null
})
async function compare() {
  if (!ready.value || busy.value) return
  busy.value = true
  error.value = null
  const query = { beforeVersionId: beforeVersion.value!.id, beforeRecordId: beforeRelease.value!.id, afterVersionId: afterVersion.value!.id, afterRecordId: afterRelease.value!.id, page: page.value, pageSize: 20 }
  try {
    const response = await $fetch<{ code: number, data: Diff }, string>(`/api/v1/products/${encodeURIComponent(code.value)}/roadmaps/release-diff`, { query, timeout: 15000 })
    const value = response.data
    if (response.code !== 0 || !validReleaseDiff(value, code.value, query)) throw new Error('发布对比响应不完整')
    data.value = value
  } catch (cause) {
    data.value = null
    error.value = cause instanceof Error ? cause : new Error('读取失败')
  } finally { busy.value = false }
}
watch(page, () => {
  if (data.value) void compare()
})
onBeforeRouteLeave(() => !busy.value)
onBeforeRouteUpdate(() => !busy.value)
</script>

<template>
  <div class="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
    <ProductsVersionTools :product-code="code" />
    <p class="text-sm text-muted">
      按所选顺序比较冻结的发布范围。撤回或被更正的记录仍可查看历史，发布不代表已经部署。
    </p>
    <div class="grid gap-4 lg:grid-cols-2">
      <section class="min-w-0 space-y-3 rounded border border-default p-3">
        <h2 class="font-semibold">
          对比前
        </h2>
        <ProductsVersionPicker
          v-model="beforeVersion"
          :product-code="code"
          include-published
          :disabled="busy"
          search-label="搜索对比前版本"
        />
        <ProductsReleasePicker
          v-if="beforeVersion"
          :key="beforeVersion.id"
          v-model="beforeRelease"
          :product-code="code"
          :version-id="beforeVersion.id"
          :disabled="busy"
        />
      </section>
      <section class="min-w-0 space-y-3 rounded border border-default p-3">
        <h2 class="font-semibold">
          对比后
        </h2>
        <ProductsVersionPicker
          v-model="afterVersion"
          :product-code="code"
          include-published
          :disabled="busy"
          search-label="搜索对比后版本"
        />
        <ProductsReleasePicker
          v-if="afterVersion"
          :key="afterVersion.id"
          v-model="afterRelease"
          :product-code="code"
          :version-id="afterVersion.id"
          :disabled="busy"
        />
      </section>
    </div>
    <UButton :disabled="!ready" :loading="busy" @click="compare">
      比较发布范围
    </UButton>
    <UAlert v-if="alert" v-bind="alert" />
    <section v-if="data && !busy" class="space-y-3">
      <p>新增 {{ data.added }} · 移除 {{ data.removed }} · 变更 {{ data.changed }} · 未变 {{ data.unchanged }}</p>
      <CommonEmptyState
        v-if="!data.changes.length"
        icon="i-lucide-git-compare"
        title="本页没有差异"
        description="统计基于完整快照，可调整页码查看其他差异。"
      />
      <article v-for="change in data.changes" :key="change.scope_id" class="space-y-3 rounded border border-default p-3">
        <h3 class="font-semibold">
          {{ kinds[change.kind] }} · {{ change.after?.title || change.before?.title }}
        </h3>
        <div class="grid gap-3 md:grid-cols-2">
          <div v-for="side in (['before', 'after'] as const)" :key="side" class="min-w-0 space-y-2">
            <h4 class="font-medium">
              {{ side === 'before' ? '对比前' : '对比后' }}
            </h4>
            <p v-if="!change[side]" class="text-sm text-muted">
              该发布中不存在此范围。
            </p>
            <template v-else>
              <p class="break-words font-medium">
                {{ change[side]!.title }}
              </p>
              <p class="whitespace-pre-wrap break-words">
                {{ change[side]!.description || '未填写描述' }}
              </p>
              <p class="whitespace-pre-wrap break-words text-sm">
                验收标准：{{ change[side]!.acceptance_criteria || '未填写' }}
              </p>
              <p class="text-sm">
                状态：{{ ({ planned: '计划中', delivered: '已交付', deferred: '已顺延' } as Record<string, string>)[change[side]!.status] || change[side]!.status }}
              </p>
              <p class="text-sm">
                类别：{{ change[side]!.category || '未分类' }} · {{ change[side]!.is_public ? '公开范围' : '内部范围' }} · 顺序 {{ change[side]!.sort_order }}
              </p>
              <p class="text-sm">
                变更类型：{{ ({ new: '新增', enhancement: '增强', fix: '修复', retirement: '退役' } as Record<string, string>)[change[side]!.change_type || ''] || '未记录' }}
              </p>
              <p class="text-sm">
                {{ change[side]!.legacy_unscored ? '历史未评分范围' : '已关联规划范围' }}
              </p>
              <p v-if="change[side]!.deferred_from_feature_id" class="text-sm">
                顺延来源范围：{{ change[side]!.deferred_from_feature_id }}
              </p>
              <UButton v-if="change[side]!.product_feature_biz_id" :to="`/products/${encodeURIComponent(code)}/features/${change[side]!.product_feature_biz_id}`" variant="link">
                查看关联功能
              </UButton>
              <UButton v-if="change[side]!.planning_item_biz_id" :to="`/products/${encodeURIComponent(code)}/planning-items/${change[side]!.planning_item_biz_id}`" variant="link">
                查看关联规划事项
              </UButton>
            </template>
          </div>
        </div>
      </article>
      <div class="flex flex-wrap items-center gap-2">
        <span>共 {{ data.total }} 项差异</span><UPagination v-model:page="page" :items-per-page="20" :total="data.total" />
      </div>
    </section>
  </div>
</template>
