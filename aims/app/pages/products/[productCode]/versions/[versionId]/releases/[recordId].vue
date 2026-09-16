<script setup lang="ts">
import type { ProductRelease } from '~/types/productRelease'

definePageMeta({ layoutHeader: true, layoutHeaderTitle: '发布快照', layoutHeaderProjectSwitcher: false })
const route = useRoute()
const versionPerspectiveQuery = computed(() => route.query.view === 'gtm' ? { view: 'gtm' } : {})
const code = computed(() => String(route.params.productCode || ''))
const versionID = computed(() => String(route.params.versionId || ''))
const recordID = computed(() => String(route.params.recordId || ''))
const base = computed(() => `/products/${encodeURIComponent(code.value)}/versions/${encodeURIComponent(versionID.value)}`)
const labels: Record<string, string> = { 'execution-review': '执行目标评审', 'blocking-defects-review': '阻塞缺陷评审', 'release-readiness': '发布就绪评审' }
const { data, status, error, refresh } = await useFetch(() => `/api/v1${base.value}/releases/${encodeURIComponent(recordID.value)}`, {
  server: false,
  transform: (response: { code: number, data: ProductRelease }) => {
    const r = response.data
    if (response.code !== 0 || String(r?.id) !== recordID.value || String(r.version_id) !== versionID.value || !['verified', 'legacy_import'].includes(r.evidence_level) || !Array.isArray(r.scopes) || !Array.isArray(r.checks) || !Array.isArray(r.exceptions) || (r.snapshot_available && (r.version?.product_code !== code.value || String(r.version.id) !== versionID.value))) throw new Error('发布快照响应不完整')
    return r
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '发布快照读取失败' })
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
    <UButton :to="{ path: `${base}/releases`, query: versionPerspectiveQuery }" color="neutral" variant="outline">
      查看全部发布历史
    </UButton>
    <h1 class="text-xl font-semibold">
      发布快照
    </h1>
    <UAlert v-if="alert" v-bind="alert" />
    <p v-if="status === 'pending'" role="status">
      正在读取冻结的发布记录…
    </p>
    <template v-if="status === 'success' && data">
      <article class="min-w-0 space-y-3 rounded-lg border border-default p-4">
        <h2 class="break-words font-semibold">
          {{ data.version?.version_code || '存量发布记录' }}{{ data.version?.name ? ` · ${data.version.name}` : '' }}
        </h2>
        <div class="flex flex-wrap gap-2">
          <UBadge v-if="data.withdrawn" color="warning">
            已撤回
          </UBadge>
          <UBadge v-if="data.superseded" color="warning">
            已被更正
          </UBadge>
          <UBadge v-if="data.current" color="success">
            当前发布记录
          </UBadge>
          <UBadge color="neutral">
            {{ data.evidence_level === 'verified' ? '已核验发布' : '存量导入证据' }}
          </UBadge>
        </div>
        <p class="break-words text-sm">
          发布序号 {{ data.release_seq }} · {{ data.released_at ? formatDateTime(data.released_at) : '发布时间未记录' }}
        </p>
        <p class="break-words text-sm">
          发布人标识：{{ data.released_by || '未记录' }}
        </p>
        <p class="whitespace-pre-wrap break-words">
          {{ data.version?.description || '未记录版本说明' }}
        </p>
        <p class="text-sm text-muted">
          发布记录不代表客户环境已经部署或升级。
        </p>
      </article>
      <UAlert
        v-if="!data.snapshot_available"
        color="warning"
        title="该存量记录没有新流程的完整核验快照"
        description="保留原始证据等级；不以当前版本内容补写历史。"
      />
      <template v-else>
        <h2 class="font-semibold">
          发布时范围（{{ data.scopes.length }}）
        </h2>
        <p v-if="!data.scopes.length" class="text-sm text-muted">
          本次发布没有登记范围条目。
        </p>
        <article v-for="scope in data.scopes" :key="scope.id" class="min-w-0 space-y-2 rounded-lg border border-default p-4">
          <h3 class="break-words font-medium">
            {{ scope.title }}
          </h3>
          <UBadge :color="scope.status === 'delivered' ? 'success' : 'neutral'">
            {{ scope.status === 'delivered' ? '已交付' : scope.status === 'deferred' ? '已顺延' : '未处理' }}
          </UBadge>
          <p class="whitespace-pre-wrap break-words">
            {{ scope.description || '未记录说明' }}
          </p>
          <p class="whitespace-pre-wrap break-words">
            验收标准：{{ scope.acceptance_criteria || '未记录' }}
          </p>
        </article>
        <h2 class="font-semibold">
          发布时验收依据
        </h2>
        <p class="break-words text-sm">
          验收人标识：{{ data.accepted_by }} · {{ formatDateTime(data.accepted_at) }}
        </p>
        <article v-for="check in data.checks" :key="check.code" class="min-w-0 space-y-2 rounded-lg border border-default p-4">
          <h3 class="font-medium">
            {{ labels[check.code] || '其他核验依据' }}
          </h3>
          <p class="whitespace-pre-wrap break-words">
            {{ check.evidence }}
          </p>
        </article>
        <h2 class="font-semibold">
          发布时例外（{{ data.exceptions.length }}）
        </h2>
        <p v-if="!data.exceptions.length" class="text-sm text-muted">
          本次发布未登记例外。
        </p>
        <article v-for="(item, index) in data.exceptions" :key="item.code" class="min-w-0 space-y-2 rounded-lg border border-default p-4">
          <h3 class="font-medium">
            例外 {{ index + 1 }}
          </h3>
          <p class="whitespace-pre-wrap break-words">
            {{ item.reason }}
          </p>
          <p class="whitespace-pre-wrap break-words">
            影响：{{ item.impact }}
          </p>
          <p class="break-words text-sm">
            责任人标识：{{ item.responsible_uid }}
          </p>
        </article>
      </template>
    </template>
  </div>
</template>
