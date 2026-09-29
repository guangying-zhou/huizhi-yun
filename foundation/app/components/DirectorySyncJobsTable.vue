<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type { DirectorySyncJob } from '../types/consoleDirectorySync'

const props = withDefaults(defineProps<{ jobs: DirectorySyncJob[], loading?: boolean, detailPath?: string, returnTo?: string, redacted?: boolean }>(), { detailPath: '/directory/sync', redacted: false })
const UBadge = resolveComponent('UBadge')
const UButton = resolveComponent('UButton')
function statusMeta(status: string) {
  if (status === 'success') return { label: '成功', color: 'success' as const }
  if (status === 'running') return { label: '运行中', color: 'warning' as const }
  if (status === 'failed') return { label: '失败', color: 'error' as const }
  if (status === 'partial_success') return { label: '部分成功', color: 'warning' as const }
  return { label: status, color: 'neutral' as const }
}

const jobColumns: TableColumn<DirectorySyncJob>[] = [
  {
    accessorKey: 'jobCode',
    header: '任务',
    cell: ({ row }) => h('div', { class: 'sync-job-label' }, [
      h(UButton, {
        to: `${props.detailPath}/${encodeURIComponent(row.original.jobCode)}${props.returnTo ? `?returnTo=${encodeURIComponent(props.returnTo)}` : ''}`,
        variant: 'link',
        color: 'primary',
        class: 'p-0 font-medium'
      }, () => row.original.jobCode),
      (props.redacted ? row.original.failureCategory : row.original.errorMessage)
        ? h('p', { class: 'text-xs text-error' }, (props.redacted ? row.original.failureCategory : row.original.errorMessage) || '')
        : null
    ])
  },
  {
    id: 'provider',
    header: 'Provider',
    cell: ({ row }) => h('span', { class: 'text-muted' }, `${row.original.providerCode} / ${row.original.syncType}`)
  },
  {
    accessorKey: 'objectScope',
    header: '范围',
    cell: ({ row }) => h('span', { class: 'text-muted' }, row.original.objectScope)
  },
  {
    accessorKey: 'status',
    header: '状态',
    cell: ({ row }) => {
      const meta = statusMeta(row.original.status)
      return h(UBadge, { color: meta.color, variant: 'soft' }, () => meta.label)
    }
  },
  {
    id: 'counts',
    header: '数量',
    cell: ({ row }) => h('span', { class: 'text-muted sync-job-counts' }, `${row.original.totalCount} total / ${row.original.errorCount} errors`)
  },
  {
    id: 'time',
    header: '时间',
    cell: ({ row }) => h('span', { class: 'text-muted' }, row.original.finishedAt || row.original.startedAt || row.original.createdAt)
  }
]
</script>

<template>
  <UTable
    sticky
    :data="jobs"
    :columns="jobColumns"
    :loading="loading"
    empty="暂无同步任务"
    class="sync-jobs-table flex-1 max-h-[calc(100svh-26rem)] rounded-lg border border-default"
  >
    <template #empty>
      <CommonEmptyState icon="i-lucide-refresh-cw" title="暂无同步任务" description="配置目录源并启动同步后会显示在这里。" />
    </template>
  </UTable>
</template>

<style scoped>
@media (max-width: 639px) {
  .sync-jobs-table :deep(table) { width: 100%; table-layout: fixed; }
  .sync-jobs-table :deep(th), .sync-jobs-table :deep(td) { padding: 0.75rem 0.5rem; white-space: normal; overflow-wrap: anywhere; }
  .sync-jobs-table :deep(th:nth-child(2)), .sync-jobs-table :deep(td:nth-child(2)),
  .sync-jobs-table :deep(th:nth-child(3)), .sync-jobs-table :deep(td:nth-child(3)),
  .sync-jobs-table :deep(th:nth-child(6)), .sync-jobs-table :deep(td:nth-child(6)) { display: none; }
  .sync-jobs-table :deep(th:nth-child(4)) { width: 4.5rem; }
  .sync-jobs-table :deep(th:nth-child(5)) { width: 5rem; }
  .sync-jobs-table :deep(.sync-job-label a) { white-space: normal; overflow-wrap: anywhere; }
  .sync-jobs-table :deep(.sync-job-counts) { font-size: 0.75rem; }
}
</style>
