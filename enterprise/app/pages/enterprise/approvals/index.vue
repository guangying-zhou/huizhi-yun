<script setup lang="ts">
import ContentPageHeader from '../../../../../foundation/app/components/ContentPageHeader.vue'

const { page, pageSize } = useListPage({ pageSize: 20 })
const business = ref('aims/tasks/complete')
const businessOptions = [
  { label: '工作项完成审批', value: 'aims/tasks/complete' },
  { label: '报价审批', value: 'altoc/quotation/approve' },
  { label: '合同审批', value: 'altoc/contract/approve' },
  { label: '开票申请审批', value: 'finance/invoices/request' },
  { label: '费用报销审批', value: 'finance/expenses/claim' },
  { label: '项目支出审批', value: 'finance/expenses/project_expense' },
  { label: '付款申请审批', value: 'finance/expenses/payment' },
  { label: '任职变更审批', value: 'people/assignments/change' }
]
const { tasks, total, status, error, refresh } = useHostPendingApprovals(page, pageSize, business)
</script>

<template>
  <section class="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
    <ContentPageHeader
      title="待办审批"
      hosted
      description="这里只显示分配给你的 Workflow 审批任务。"
    >
      <template #actions>
        <UButton
          color="neutral"
          variant="soft"
          icon="i-lucide-refresh-cw"
          :loading="status === 'pending'"
          @click="refresh()"
        >
          刷新
        </UButton>
      </template>
    </ContentPageHeader>
    <USelect
      v-model="business"
      :items="businessOptions"
      aria-label="审批业务"
      class="w-full sm:w-64"
    />
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
      <UPagination
        v-model:page="page"
        :total="total"
        :items-per-page="pageSize"
        :disabled="status === 'pending'"
      />
    </div>
  </section>
</template>
