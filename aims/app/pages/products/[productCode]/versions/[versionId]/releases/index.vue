<script setup lang="ts">
import type { ProductReleasePage } from '~/types/productRelease'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '发布历史', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const versionPerspectiveQuery = computed(() => route.query.view === 'gtm' ? { view: 'gtm' } : {})
const code = computed(() => String(route.params.productCode || ''))
const id = computed(() => String(route.params.versionId || ''))
const base = computed(() => `/products/${encodeURIComponent(code.value)}/versions/${encodeURIComponent(id.value)}`)
const page = ref(1), pageSize = 20
watch([code, id], () => {
  page.value = 1
})
const { data, status, error, refresh } = await useFetch(() => `/api/v1${base.value}/releases`, { server: false, query: { page, pageSize }, transform: (response: { code: number, data: ProductReleasePage }) => {
  const p = response.data
  if (response.code !== 0 || !Array.isArray(p?.items) || !Number.isSafeInteger(p.total) || p.total < 0 || p.items.some(item => String(item.version_id) !== id.value || !Number.isSafeInteger(item.id) || item.id < 1 || !Number.isSafeInteger(item.release_seq) || item.release_seq < 1)) throw new Error('发布历史响应不完整')
  return p
} })
const alert = useApiErrorAlert(error, { fallbackTitle: '发布历史读取失败' })
</script>

<template>
  <div class="mx-auto min-w-0 max-w-5xl space-y-4 p-4 sm:p-6">
    <div class="flex flex-wrap gap-2">
      <UButton :to="{ path: base, query: versionPerspectiveQuery }" color="neutral" variant="ghost">
        返回版本详情
      </UButton>
      <UButton
        :loading="status === 'pending'"
        color="neutral"
        variant="outline"
        @click="refresh()"
      >
        重新读取
      </UButton>
    </div>
    <h1 class="text-xl font-semibold">
      发布历史
    </h1>
    <p class="text-sm text-muted">
      撤回和更正保留原始记录。发布记录不代表客户环境已经部署。
    </p>
    <UAlert v-if="alert" v-bind="alert" />
    <p v-if="status === 'pending'" role="status">
      正在读取发布历史…
    </p>
    <template v-if="status === 'success' && data">
      <CommonEmptyState
        v-if="!data.items.length"
        icon="i-lucide-history"
        title="暂无发布记录"
        description="完成正式发布后，记录将显示在这里。"
      />
      <article v-for="item in data.items" :key="item.id" class="min-w-0 space-y-3 rounded-lg border border-default p-4">
        <h2 class="font-medium">
          第 {{ item.release_seq }} 次发布
        </h2>
        <div class="flex flex-wrap gap-2">
          <UBadge v-if="item.current" color="success">
            当前发布记录
          </UBadge>
          <UBadge v-if="item.withdrawn" color="warning">
            已撤回
          </UBadge>
          <UBadge v-if="item.superseded" color="warning">
            已被更正
          </UBadge>
          <UBadge color="neutral">
            {{ item.evidence_level === 'verified' ? '已核验发布' : '存量导入证据' }}
          </UBadge>
        </div>
        <p class="break-words text-sm">
          {{ item.released_at ? formatDateTime(item.released_at) : '发布时间未记录' }} · 发布人标识：{{ item.released_by || '未记录' }}
        </p>
        <div class="flex flex-wrap gap-2">
          <UButton :to="{ path: `${base}/releases/${item.id}`, query: versionPerspectiveQuery }" color="neutral" variant="outline">
            查看本次快照
          </UButton>
          <UButton
            v-if="item.supersedes_record_id"
            :to="{ path: `${base}/releases/${item.supersedes_record_id}`, query: versionPerspectiveQuery }"
            color="neutral"
            variant="ghost"
          >
            查看更正前的原记录
          </UButton>
        </div>
      </article>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <span class="text-sm text-muted">共 {{ data.total }} 条</span>
        <UPagination v-model:page="page" :items-per-page="pageSize" :total="data.total" />
      </div>
    </template>
  </div>
</template>
