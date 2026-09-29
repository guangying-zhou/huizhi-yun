<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type { DirectorySyncJob, DirectorySyncEvent } from '../types/consoleDirectorySync'

const props = withDefaults(defineProps<{ job: DirectorySyncJob, events: DirectorySyncEvent[], eventsPending?: boolean, eventsError?: { message?: string } | null, redacted?: boolean }>(), { redacted: false })
const UBadge = resolveComponent('UBadge')
const counters = computed(() => [
  { label: '总数', value: props.job?.totalCount || 0 },
  { label: '新增', value: props.job?.createdCount || 0 },
  { label: '更新', value: props.job?.updatedCount || 0 },
  { label: '删除', value: props.job?.deletedCount || 0 },
  { label: '跳过', value: props.job?.skippedCount || 0 },
  { label: '错误', value: props.job?.errorCount || 0 }
])

function statusMeta(status: string) {
  if (status === 'success') return { label: '成功', color: 'success' as const }
  if (status === 'running') return { label: '运行中', color: 'warning' as const }
  if (status === 'failed') return { label: '失败', color: 'error' as const }
  if (status === 'partial_success') return { label: '部分成功', color: 'warning' as const }
  if (status === 'skipped') return { label: '跳过', color: 'neutral' as const }
  return { label: status, color: 'neutral' as const }
}

function eventStatusColor(status: string) {
  if (status === 'success') return 'success' as const
  if (status === 'failed') return 'error' as const
  return 'neutral' as const
}

const eventColumns = computed<TableColumn<DirectorySyncEvent>[]>(() => [
  {
    accessorKey: 'status',
    header: '状态',
    cell: ({ row }) => h(UBadge, { color: eventStatusColor(row.original.status), variant: 'soft' }, () => row.original.status)
  },
  {
    id: 'object',
    header: '对象',
    cell: ({ row }) => h('div', [
      h('p', { class: 'font-medium' }, row.original.objectType),
      h('p', { class: 'text-xs text-muted' }, row.original.objectCode)
    ])
  },
  {
    accessorKey: 'changeType',
    header: '变更',
    cell: ({ row }) => h('span', { class: 'text-muted' }, row.original.changeType)
  },
  {
    id: 'source',
    header: '来源',
    cell: ({ row }) => h('div', { class: 'text-muted' }, [
      h('p', row.original.sourceProvider),
      props.redacted ? null : h('p', { class: 'text-xs' }, row.original.externalRef || '-')
    ])
  },
  {
    accessorKey: props.redacted ? 'failureCategory' : 'message',
    header: '消息',
    cell: ({ row }) => h('span', { class: 'text-muted' }, (props.redacted ? row.original.failureCategory : row.original.message) || '-')
  },
  {
    accessorKey: 'createdAt',
    header: '时间',
    cell: ({ row }) => h('span', { class: 'text-muted' }, row.original.createdAt)
  }
])
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="font-semibold">
            {{ job.jobCode }}
          </h2>
          <p class="text-sm text-muted">
            {{ job.providerCode }} / {{ job.syncType }} / {{ job.objectScope }}
          </p>
        </div>
        <UBadge :color="statusMeta(job.status).color" variant="soft">
          {{ statusMeta(job.status).label }}
        </UBadge>
      </div>
    </template>

    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <div
        v-for="counter in counters"
        :key="counter.label"
        class="rounded-lg border border-default bg-muted/20 p-3"
      >
        <p class="text-xs text-muted">
          {{ counter.label }}
        </p>
        <p class="mt-1 text-xl font-semibold">
          {{ counter.value }}
        </p>
      </div>
    </div>

    <UAlert
      v-if="(redacted ? job.failureCategory : job.errorMessage)"
      color="error"
      variant="soft"
      title="错误信息"
      :description="(redacted ? job.failureCategory : job.errorMessage) || undefined"
      class="mt-4"
    />

    <div class="mt-4 grid gap-3 text-sm text-muted lg:grid-cols-4">
      <p v-if="!redacted">
        请求人：{{ job.requestedBy || '-' }}
      </p>
      <p>开始：{{ job.startedAt || '-' }}</p>
      <p>结束：{{ job.finishedAt || '-' }}</p>
      <p>创建：{{ job.createdAt }}</p>
    </div>
  </UCard>

  <UCard>
    <template #header>
      <div>
        <h2 class="font-semibold">
          同步事件
        </h2>
        <p class="text-sm text-muted">
          展示最近的同步事件。
        </p>
      </div>
    </template>

    <UAlert
      v-if="eventsError"
      color="error"
      variant="soft"
      title="事件加载失败"
      :description="redacted ? '请稍后重试。' : eventsError.message"
      class="mb-3"
    />

    <UTable
      sticky
      :data="events"
      :columns="eventColumns"
      :loading="eventsPending"
      empty="暂无同步事件"
      class="flex-1 max-h-[calc(100svh-30rem)] rounded-lg border border-default"
    >
      <template #empty>
        <CommonEmptyState icon="i-lucide-list-tree" title="暂无同步事件" description="任务开始处理目录对象后会显示事件记录。" />
      </template>
    </UTable>
  </UCard>
</template>
