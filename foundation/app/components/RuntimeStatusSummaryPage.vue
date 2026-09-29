<script setup lang="ts">
import type { ConsoleRuntimeSummary } from '../types/consoleRuntimeSummary'

const props = defineProps<{ kind: 'data' | 'applications' }>()
const title = props.kind === 'data' ? '数据运行时' : '应用运行状态'
const consolePath = props.kind === 'data' ? '/console/data-runtime' : '/console/admin/runtime-apps'
usePageTitle(title)
const { data, pending, error, refresh } = await useFetch<{ code: number, data: ConsoleRuntimeSummary }>(`/enterprise/api/runtime-status/${props.kind}`)
const summary = computed(() => data.value?.data)
const statusLabels = { healthy: '正常', degraded: '异常', unavailable: '不可用', unknown: '状态未知' }
const failureLabels = {
  'runtime-unavailable': '数据运行时暂不可用', 'runtime-unhealthy': '数据运行时健康检查异常',
  'applications-unavailable': '应用状态监控暂不可用', 'applications-degraded': '部分已启用应用状态异常'
}
</script>

<template>
  <UDashboardPanel :id="`enterprise-runtime-${kind}`">
    <template #body>
      <ContentPageHeader hosted :title="title" :description="kind === 'data' ? '查看数据运行时的版本与健康状态。' : '查看已启用应用的整体运行状态。'" />
      <div class="flex flex-wrap items-center gap-2">
        <UButton
          :to="consolePath"
          external
          color="neutral"
          variant="outline"
          :label="kind === 'data' ? '在控制台查看配置或更新' : '在控制台查看应用或启停'"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          aria-label="刷新运行状态"
          :loading="pending"
          @click="refresh()"
        />
      </div>
      <CommonEmptyState v-if="error?.statusCode === 403" title="无权限" description="你没有查看运行状态的权限。" />
      <UAlert
        v-else-if="error"
        color="error"
        title="运行状态加载失败"
        description="请稍后重试。"
      />
      <UCard v-else-if="summary" class="min-w-0">
        <dl class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <dt class="text-sm text-muted">
              状态
            </dt><dd>
              <UBadge :color="summary.healthy ? 'success' : 'warning'">
                {{ statusLabels[summary.status] }}
              </UBadge>
            </dd>
          </div>
          <div>
            <dt class="text-sm text-muted">
              可用性
            </dt><dd>{{ summary.available ? '可用' : '不可用' }}</dd>
          </div>
          <div v-if="kind === 'data'">
            <dt class="text-sm text-muted">
              当前版本
            </dt><dd class="break-all">
              {{ summary.version || '—' }}
            </dd>
          </div>
          <div>
            <dt class="text-sm text-muted">
              检查时间
            </dt><dd class="break-all">
              {{ summary.checkedAt }}
            </dd>
          </div>
          <div v-if="summary.lastSeenAt">
            <dt class="text-sm text-muted">
              最近在线时间
            </dt><dd class="break-all">
              {{ summary.lastSeenAt }}
            </dd>
          </div>
        </dl>
        <UAlert
          v-if="summary.failureCategory"
          color="warning"
          class="mt-4"
          :title="failureLabels[summary.failureCategory]"
          description="可在控制台查看详情。"
        />
      </UCard>
      <CommonEmptyState v-else-if="!pending" title="暂无状态" description="请刷新重试。" />
    </template>
  </UDashboardPanel>
</template>
