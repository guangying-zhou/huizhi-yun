<script setup lang="ts">
import type { DirectorySyncJob } from '@hzy/foundation/app/types/consoleDirectorySync'
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('目录同步')

interface ApiResponse<T> {
  code: number
  data: T
}

const toast = useToast()
const { loaded: permissionsLoaded, loadPermissions, hasPermission } = usePermissions()
const running = ref(false)
const runningProvider = ref<string | null>(null)

if (!permissionsLoaded.value) {
  await loadPermissions()
}

const { data, pending, error, refresh } = await useFetch<ApiResponse<DirectorySyncJob[]>>('/api/v1/console/directory/sync-jobs', {
  query: { limit: 30 },
  default: () => ({ code: 0, data: [] })
})

const jobs = computed(() => data.value?.data || [])
const canRunSync = computed(() => permissionsLoaded.value && hasPermission('directory_sync', 'edit'))
const canRebuildSubjectExports = computed(() => permissionsLoaded.value && hasPermission('directory_sync', 'admin'))

async function rebuildSubjectExports() {
  if (!canRebuildSubjectExports.value) {
    toast.add({
      title: '权限不足',
      description: '需要目录同步管理员权限。',
      color: 'warning'
    })
    return
  }

  running.value = true
  try {
    const result = await $fetch<ApiResponse<DirectorySyncJob>>('/api/v1/console/directory/sync-jobs', {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: {
        providerCode: 'console',
        syncType: 'manual',
        objectScope: 'subjects'
      }
    })

    toast.add({
      title: 'Platform 主体已同步',
      description: `任务 ${result.data.jobCode}：共 ${result.data.totalCount} 条`,
      color: 'success'
    })
    await refresh()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({
      title: '同步任务失败',
      description: error.data?.message || error.message || '未知错误',
      color: 'error'
    })
  } finally {
    running.value = false
  }
}

async function runProviderSync(providerCode: 'ldap') {
  if (!canRunSync.value) {
    toast.add({
      title: '权限不足',
      description: '需要目录同步编辑权限。',
      color: 'warning'
    })
    return
  }

  runningProvider.value = providerCode
  try {
    const result = await $fetch<ApiResponse<DirectorySyncJob>>('/api/v1/console/directory/sync-jobs', {
      method: 'POST',
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: {
        providerCode,
        syncType: 'manual',
        objectScope: 'all'
      }
    })

    const asyncProvider = result.data.status === 'pending' || result.data.status === 'running'
    toast.add({
      title: asyncProvider ? 'LDAP 同步任务已提交' : '目录源同步已完成',
      description: asyncProvider
        ? `Connector 任务 ${result.data.jobCode} 将在后台执行。`
        : `任务 ${result.data.jobCode}：共 ${result.data.totalCount} 条`,
      color: asyncProvider ? 'info' : 'success'
    })
    await refresh()
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({
      title: '目录源同步失败',
      description: error.data?.message || error.message || '未知错误',
      color: 'error'
    })
  } finally {
    runningProvider.value = null
  }
}
</script>

<template>
  <UDashboardPanel id="directory-sync" :ui="dashboardPanelUi">
    <template #body>
      <div class="grid gap-3 lg:grid-cols-3">
        <UCard>
          <template #header>
            <span class="font-semibold">Subject Export</span>
          </template>
          <p class="text-sm text-muted">
            从 Console Directory 生成最小 subject 投影并同步到 Platform，供租户角色授权选择主体。
          </p>
          <template #footer>
            <UButton
              icon="i-lucide-play"
              :loading="running"
              :disabled="!canRebuildSubjectExports"
              @click="rebuildSubjectExports"
            >
              同步到 Platform
            </UButton>
          </template>
        </UCard>

        <UCard>
          <template #header>
            <span class="font-semibold">外部目录源</span>
          </template>
          <p class="text-sm text-muted">
            LDAP 技术目录同步由客户侧 Connector 执行。钉钉组织和人员事实同步已迁移到 People，由 People 管理员操作。
          </p>
          <template #footer>
            <div class="flex flex-wrap gap-2">
              <UButton
                size="sm"
                variant="ghost"
                icon="i-lucide-network"
                :loading="runningProvider === 'ldap'"
                :disabled="!canRunSync"
                @click="runProviderSync('ldap')"
              >
                同步 LDAP
              </UButton>
              <UButton
                size="sm"
                variant="ghost"
                icon="i-lucide-external-link"
                to="/shell/people?target=%2Fpeople%2Fsettings%2Fhr-source-sync"
              >
                前往 People
              </UButton>
            </div>
          </template>
        </UCard>

        <UCard>
          <template #header>
            <span class="font-semibold">任务模型</span>
          </template>
          <p class="text-sm text-muted">
            所有同步动作统一记录到 `directory_sync_jobs` 与 `directory_sync_events`，便于审计、重试和后续异步 worker 化。
          </p>
        </UCard>
      </div>

      <UCard>
        <template #header>
          <div>
            <h2 class="font-semibold">
              最近同步任务
            </h2>
            <p class="text-sm text-muted">
              当前展示最近 30 条任务。
            </p>
          </div>
        </template>

        <UAlert
          v-if="error"
          color="error"
          variant="soft"
          title="加载失败"
          :description="error.message"
          class="mb-3"
        />

        <DirectorySyncJobsTable :jobs="jobs" :loading="pending" />
      </UCard>
    </template>
  </UDashboardPanel>
</template>
