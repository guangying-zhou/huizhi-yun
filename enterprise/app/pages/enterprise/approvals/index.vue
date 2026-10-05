<script setup lang="ts">
const { page, pageSize } = useListPage({ pageSize: 20 })
const { tasks, total, status, error, refresh } = useHostPendingApprovals(page, pageSize)
</script>

<template>
  <section class="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
    <div class="flex items-center justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold">
          待办审批
        </h1>
        <p class="mt-1 text-sm text-muted">
          这里只显示分配给你的 Workflow 审批任务。
        </p>
      </div>
      <UButton
        color="neutral"
        variant="soft"
        icon="i-lucide-refresh-cw"
        :loading="status === 'pending'"
        @click="refresh()"
      >
        刷新
      </UButton>
    </div>
    <UAlert
      v-if="error"
      color="error"
      title="待办读取失败"
      description="请稍后刷新。"
    />
    <USkeleton
      v-else-if="status === 'pending'"
      class="h-40 w-full"
    />
    <p
      v-else-if="!tasks.length"
      class="rounded-lg border border-default p-6 text-sm text-muted"
    >
      本页没有待办任务。
    </p>
    <div
      v-else
      class="space-y-3"
    >
      <UCard
        v-for="task in tasks"
        :key="task.task_id"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p class="font-medium">
              {{ task.biz_title || '审批事项' }}
            </p>
            <p class="mt-1 text-sm text-muted">
              {{ task.action_name || '完成确认' }} · {{ task.node_name || '审批' }} · {{ task.instance_no }}
            </p>
          </div>
          <UButton
            :to="{ path: `/enterprise/approvals/${task.task_id}`, query: { returnPage: page > 1 ? String(page) : undefined } }"
            variant="soft"
          >
            打开任务
          </UButton>
        </div>
      </UCard>
    </div>
    <div class="flex flex-wrap items-center justify-between gap-3">
      <span class="text-sm text-muted">共 {{ total }} 条</span>
      <UPagination v-model:page="page" :total="total" :items-per-page="pageSize" :disabled="status === 'pending'" />
    </div>
  </section>
</template>
