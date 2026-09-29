<script setup lang="ts">
import type { DirectorySyncJob, DirectorySyncEvent } from '@hzy/foundation/app/types/consoleDirectorySync'
import { dashboardPanelUi } from '~/utils/dashboardPanel'

const route = useRoute()
const jobCode = computed(() => String(route.params.jobCode || ''))
usePageTitle('同步任务详情')

interface ApiResponse<T> {
  code: number
  data: T
}

const { data: jobData, pending: jobPending, error: jobError, refresh: refreshJob } = await useFetch<ApiResponse<DirectorySyncJob>>(
  () => `/api/v1/console/directory/sync-jobs/${jobCode.value}`,
  { watch: [jobCode] }
)

const { data: eventData, pending: eventsPending, error: eventsError, refresh: refreshEvents } = await useFetch<ApiResponse<DirectorySyncEvent[]>>(
  () => `/api/v1/console/directory/sync-jobs/${jobCode.value}/events`,
  {
    query: { limit: 200 },
    default: () => ({ code: 0, data: [] }),
    watch: [jobCode]
  }
)

const job = computed(() => jobData.value?.data)
const events = computed(() => eventData.value?.data || [])

async function refreshAll() {
  await Promise.all([refreshJob(), refreshEvents()])
}
</script>

<template>
  <UDashboardPanel id="directory-sync-job-detail" :ui="dashboardPanelUi">
    <template #header>
      <UDashboardNavbar title="同步任务详情">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            to="/directory/sync"
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
          >
            返回列表
          </UButton>
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            :loading="jobPending || eventsPending"
            @click="refreshAll"
          >
            刷新
          </UButton>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <UAlert
        v-if="jobError"
        color="error"
        variant="soft"
        title="任务加载失败"
        :description="jobError.message"
      />

      <template v-if="job">
        <DirectorySyncJobDetails
          :job="job"
          :events="events"
          :events-pending="eventsPending"
          :events-error="eventsError"
        />
      </template>
    </template>
  </UDashboardPanel>
</template>
