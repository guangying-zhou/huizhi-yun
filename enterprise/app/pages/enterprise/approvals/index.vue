<script setup lang="ts">
type PendingTask = { task_id: number, instance_no: string, biz_title: string, action_name: string, node_name: string, created_at: string }
type Page = { items: PendingTask[], page: number, nextPage: number | null }
const page = ref(1)
const { data, status, error, refresh } = await useFetch<{ code: number, data: Page }>('/api/workflow-proxy/tasks/pending', {
  server: false,
  query: computed(() => ({ page: page.value }))
})
const tasks = computed(() => data.value?.code === 0 ? data.value.data.items : [])
const nextPage = computed(() => data.value?.code === 0 ? data.value.data.nextPage : null)
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
      v-if="error || (data && data.code !== 0)"
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
            :to="`/enterprise/approvals/${task.task_id}`"
            variant="soft"
          >
            打开任务
          </UButton>
        </div>
      </UCard>
    </div>
    <div class="flex justify-between gap-3">
      <UButton
        color="neutral"
        variant="ghost"
        :disabled="page <= 1"
        @click="page--"
      >
        上一页
      </UButton>
      <span class="self-center text-sm text-muted">第 {{ page }} 页</span>
      <UButton
        color="neutral"
        variant="ghost"
        :disabled="!nextPage"
        @click="page = nextPage!"
      >
        下一页
      </UButton>
    </div>
  </section>
</template>
