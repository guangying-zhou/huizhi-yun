<script setup lang="ts">
const props = defineProps<{ productCode: string, versionId: string, scopeId: number }>()
interface Entry { id: number, action: 'scope-deliver' | 'scope-reopen' | 'scope-legacy-criteria' | 'scope-create' | 'scope-edit', actor_uid: string, created_at: string, revision: number, reason: string, evidence: string, before_criteria: string | null, after_criteria: string | null }
const labels = { 'scope-deliver': '确认交付', 'scope-reopen': '撤回交付确认', 'scope-legacy-criteria': '补录历史验收标准', 'scope-create': '创建版本范围', 'scope-edit': '修改版本范围' }
const page = ref(1)
const { data, status, error, refresh } = await useFetch(() => `/api/v1/products/${encodeURIComponent(props.productCode)}/versions/${encodeURIComponent(props.versionId)}/features/${props.scopeId}/history`, { server: false, query: { page, pageSize: 10 }, transform: (r: { code: number, data: { version_id: number, scope_id: number, total: number, items: Entry[] } }) => {
  if (r.code !== 0 || String(r.data?.version_id) !== props.versionId || r.data.scope_id !== props.scopeId || !Number.isSafeInteger(r.data.total) || r.data.total < 0 || !Array.isArray(r.data.items) || r.data.items.some(row => !Number.isSafeInteger(row.id) || row.id < 1 || !Object.hasOwn(labels, row.action) || !Number.isSafeInteger(row.revision) || row.revision < 1 || [row.actor_uid, row.created_at, row.reason, row.evidence].some(value => typeof value !== 'string') || [row.before_criteria, row.after_criteria].some(value => value !== null && typeof value !== 'string') || (['scope-legacy-criteria', 'scope-create', 'scope-edit'].includes(row.action) && (typeof row.after_criteria !== 'string' || !row.after_criteria.trim())))) throw new Error('范围历史响应不完整')
  return r.data
} })
const alert = useApiErrorAlert(error, { fallbackTitle: '范围历史加载失败' })
</script>

<template>
  <section class="space-y-3" aria-label="范围交付历史">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h3 class="font-semibold">
        范围确认与标准历史
      </h3>
      <UButton
        color="neutral"
        variant="ghost"
        :loading="status === 'pending'"
        @click="refresh()"
      >
        刷新历史
      </UButton>
    </div>
    <UAlert v-if="alert" v-bind="alert" />
    <p v-if="status === 'pending'" role="status">
      正在读取范围历史…
    </p>
    <template v-else-if="status === 'success' && data">
      <p v-if="!data.items.length" class="text-sm text-muted">
        暂无交付或撤回记录。
      </p>
      <article v-for="row in data.items" :key="row.id" class="space-y-2 rounded-lg border border-default p-3 text-sm">
        <p class="font-medium">
          {{ labels[row.action] }}
        </p>
        <p class="break-all text-muted">
          {{ row.actor_uid }} · {{ row.created_at }} · 版本修订 {{ row.revision }}
        </p>
        <p class="whitespace-pre-wrap break-words">
          原因：{{ row.reason }}
        </p>
        <template v-if="['scope-legacy-criteria', 'scope-create', 'scope-edit'].includes(row.action)">
          <p class="whitespace-pre-wrap break-words">
            原标准：{{ row.before_criteria ?? '未填写' }}
          </p>
          <p class="whitespace-pre-wrap break-words">
            新标准：{{ row.after_criteria ?? '未提供' }}
          </p>
        </template>
        <p v-if="row.evidence" class="whitespace-pre-wrap break-words">
          验收依据：{{ row.evidence }}
        </p>
      </article>
      <UPagination
        v-if="data.total > 10"
        v-model:page="page"
        :total="data.total"
        :items-per-page="10"
        :sibling-count="0"
      />
    </template>
  </section>
</template>
