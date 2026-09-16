<script setup lang="ts">
import type { VersionAcceptanceDetail } from '~/types/productVersionAcceptance'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '验收记录详情', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const versionPerspectiveQuery = computed(() => route.query.view === 'gtm' ? { view: 'gtm' } : {})
const publishing = ref(false)
const base = computed(() => `/products/${encodeURIComponent(String(route.params.productCode || ''))}/versions/${encodeURIComponent(String(route.params.versionId || ''))}`)
const id = computed(() => String(route.params.acceptanceId || ''))
const labels: Record<string, string> = { 'execution-review': '执行目标评审', 'blocking-defects-review': '阻塞缺陷评审', 'release-readiness': '发布就绪评审' }
const { data, status, error, refresh } = await useFetch(() => `/api/v1${base.value}/acceptances/${encodeURIComponent(id.value)}`, {
  server: false,
  transform: (response: { code: number, data: VersionAcceptanceDetail }) => {
    const result = response.data
    if (response.code !== 0 || String(result?.id) !== id.value || String(result.version_id) !== String(route.params.versionId) || !Array.isArray(result.checks) || !Array.isArray(result.exceptions)) throw new Error('验收记录详情响应不完整')
    return result
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '验收记录加载失败' })
</script>

<template>
  <div class="mx-auto min-w-0 max-w-5xl space-y-4 p-4 sm:p-6">
    <div class="flex flex-wrap gap-2">
      <UButton :to="{ path: `${base}/acceptances`, query: versionPerspectiveQuery }" color="neutral" variant="ghost">
        返回验收记录
      </UButton>
      <UButton
        :loading="status === 'pending'"
        :disabled="publishing"
        color="neutral"
        variant="outline"
        @click="refresh()"
      >
        重新读取
      </UButton>
    </div>
    <UAlert v-if="alert" v-bind="alert" />
    <p v-if="status === 'pending'" role="status">
      正在加载验收依据…
    </p>
    <template v-if="status === 'success' && data">
      <ProductsVersionPublisher
        :product-code="String(route.params.productCode)"
        :version-id="String(route.params.versionId)"
        :record="data"
        @busy="publishing = $event"
      />
      <h1 class="text-xl font-semibold">
        验收记录 #{{ data.id }}
      </h1>
      <p class="break-words text-sm">
        {{ formatDateTime(data.accepted_at) }} · 验收人标识：{{ data.accepted_by }}
      </p>
      <UAlert :color="data.scope_revision === data.current_scope_revision ? 'info' : 'warning'" :title="data.scope_revision === data.current_scope_revision ? '范围修订一致，发布前仍需核验执行事实' : '当前范围已变化，请重新验收'" description="以下是保存时的核验依据与例外，不代表当前版本已发布。" />
      <article v-for="check in data.checks" :key="check.code" class="min-w-0 space-y-2 rounded-lg border border-default p-4">
        <h2 class="font-medium">
          {{ labels[check.code] || '其他核验依据' }}
        </h2>
        <p class="whitespace-pre-wrap break-words">
          {{ check.evidence }}
        </p>
      </article>
      <h2 class="font-semibold">
        例外记录（{{ data.exceptions.length }}）
      </h2>
      <p v-if="!data.exceptions.length" class="text-sm text-muted">
        本次验收未登记例外。
      </p>
      <article v-for="(exception, index) in data.exceptions" :key="exception.code" class="min-w-0 space-y-2 rounded-lg border border-default p-4">
        <h3 class="font-medium">
          例外 {{ index + 1 }} · {{ exception.code.startsWith('incomplete-target:') ? '未完成执行目标' : exception.code.startsWith('open-defect:') ? '未关闭缺陷' : '额外风险' }}
        </h3>
        <p class="whitespace-pre-wrap break-words">
          {{ exception.reason }}
        </p>
        <p class="whitespace-pre-wrap break-words">
          影响：{{ exception.impact }}
        </p>
        <p class="break-words text-sm">
          责任人标识：{{ exception.responsible_uid }}
        </p>
      </article>
    </template>
  </div>
</template>
