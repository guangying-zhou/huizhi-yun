<script setup lang="ts">
import type { ProductReleasePage, ProductReleaseSummary } from '~/types/productRelease'

const props = defineProps<{ productCode: string, versionId: number, disabled?: boolean }>()
const selected = defineModel<ProductReleaseSummary | null>({ required: true })
const page = ref(1)
const { data, status, error, refresh } = await useFetch(() => `/api/v1/products/${encodeURIComponent(props.productCode)}/versions/${props.versionId}/releases`, {
  server: false, query: { page, pageSize: 10 },
  transform: (response: { code: number, data: ProductReleasePage }) => {
    const value = response.data
    if (response.code !== 0 || !value || !Array.isArray(value.items) || !Number.isSafeInteger(value.total) || value.total < 0 || value.page !== page.value || value.pageSize !== 10 || value.items.length > 10 || value.items.length > value.total || value.items.some(item => item.version_id !== props.versionId || !Number.isSafeInteger(item.id) || item.id < 1 || !Number.isSafeInteger(item.release_seq) || item.release_seq < 1 || !['verified', 'legacy_import'].includes(item.evidence_level) || [item.current, item.withdrawn, item.superseded].some(flag => typeof flag !== 'boolean'))) throw new Error('发布记录选择列表不完整')
    return value
  }
})
const alert = useApiErrorAlert(error, { fallbackTitle: '发布记录读取失败' })
watch(() => [props.productCode, props.versionId], () => {
  selected.value = null
  page.value = 1
})
</script>

<template>
  <div class="space-y-3">
    <p v-if="selected" class="text-sm">
      已选第 {{ selected.release_seq }} 次发布 · {{ selected.released_at || '时间未记录' }}
    </p>
    <UAlert v-if="alert" v-bind="alert" />
    <UButton
      v-if="error"
      color="neutral"
      variant="outline"
      :disabled="disabled"
      @click="refresh()"
    >
      重新读取发布记录
    </UButton>
    <p v-if="status === 'pending'" role="status">
      正在读取发布记录…
    </p>
    <template v-else-if="status === 'success' && data">
      <CommonEmptyState
        v-if="!data.items.length"
        icon="i-lucide-history"
        title="本页暂无发布记录"
        description="可选择其他版本或调整页码。"
      />
      <article v-for="release in data.items" :key="release.id" class="space-y-2 rounded border border-default p-3">
        <p class="text-sm">
          第 {{ release.release_seq }} 次发布 · {{ release.released_at || '时间未记录' }}
        </p>
        <div class="flex flex-wrap gap-2">
          <UBadge v-if="release.current" color="success">
            当前发布
          </UBadge>
          <UBadge v-if="release.withdrawn" color="warning">
            已撤回
          </UBadge>
          <UBadge v-if="release.superseded" color="warning">
            已被更正
          </UBadge>
        </div>
        <p v-if="release.evidence_level === 'legacy_import'" class="text-sm text-muted">
          历史导入缺少可验证快照，不能用于范围对比。
        </p>
        <UButton
          size="sm"
          variant="outline"
          :disabled="disabled || release.evidence_level !== 'verified'"
          @click="selected = release"
        >
          {{ selected?.id === release.id ? '已选择' : '选择此发布' }}
        </UButton>
      </article>
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-sm">共 {{ data.total }} 次发布</span>
        <UPagination
          v-model:page="page"
          :items-per-page="10"
          :total="data.total"
          :disabled="disabled"
        />
      </div>
    </template>
  </div>
</template>
