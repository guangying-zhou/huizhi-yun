<script setup lang="ts">
import { useAimsModule } from '../../../../../../../layer/useAimsModule'
import type { VersionAcceptancePage } from '../../../../../../types/productVersionAcceptance'

const { moduleUrl, cacheKey } = useAimsModule()

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '版本验收记录', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const versionPerspectiveQuery = computed(() => route.query.view === 'gtm' ? { view: 'gtm' } : {})
const code = computed(() => String(route.params.productCode || ''))
const id = computed(() => String(route.params.versionId || ''))
const base = computed(() => `/products/${encodeURIComponent(code.value)}/versions/${encodeURIComponent(id.value)}`)
const page = ref(1), pageSize = 20
watch([code, id], () => {
  page.value = 1
})
const { data, status, error, refresh } = await useFetch(() => moduleUrl(`/api/v1${base.value}/acceptances`), {
  server: false, key: computed(() => cacheKey('history-acceptances-index:' + route.path)), query: { page, pageSize },
  transform: (response: { code: number, data: VersionAcceptancePage }) => {
    const result = response.data
    if (response.code !== 0 || !Array.isArray(result?.items) || !Number.isSafeInteger(result.total) || result.total < 0 || result.items.some(item => String(item.version_id) !== id.value || !Number.isSafeInteger(item.id) || item.id < 1)) throw new Error('验收记录响应不完整')
    return result
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '验收记录加载失败' })
</script>

<template>
  <div class="mx-auto min-w-0 max-w-5xl space-y-4 p-4 sm:p-6">
    <div class="flex flex-wrap gap-2">
      <UButton :to="{ path: moduleUrl(base), query: versionPerspectiveQuery }" color="neutral" variant="ghost">
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
      版本验收记录
    </h1>
    <p class="text-sm text-muted">
      记录保留保存时的依据和例外。范围一致不代表执行事实未变化，发布前仍需重新核验。
    </p>
    <UAlert v-if="alert" v-bind="alert" />
    <p v-if="status === 'pending'" role="status">
      正在加载验收记录…
    </p>
    <template v-if="status === 'success' && data">
      <CommonEmptyState
        v-if="!data.items.length"
        icon="i-lucide-clipboard-check"
        title="暂无验收记录"
        description="完成版本整体验收后，记录将显示在这里。"
      />
      <article v-for="item in data.items" :key="item.id" class="min-w-0 space-y-2 rounded-lg border border-default p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="font-medium">
            验收记录 #{{ item.id }}
          </h2>
          <UBadge :color="item.scope_revision === data.current_scope_revision ? 'neutral' : 'warning'" variant="subtle">
            {{ item.scope_revision === data.current_scope_revision ? '范围修订一致' : '范围已变化' }}
          </UBadge>
        </div>
        <p class="break-words text-sm">
          {{ formatDateTime(item.accepted_at) }} · 验收人标识：{{ item.accepted_by }}
        </p>
        <UButton :to="{ path: moduleUrl(`${base}/acceptances/${item.id}`), query: versionPerspectiveQuery }" color="neutral" variant="outline">
          查看核验依据与例外
        </UButton>
      </article>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <span class="text-sm text-muted">共 {{ data.total }} 条</span>
        <UPagination
          v-model:page="page"
          :items-per-page="pageSize"
          :total="data.total"
        />
      </div>
    </template>
  </div>
</template>
