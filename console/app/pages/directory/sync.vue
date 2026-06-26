<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('目录同步')

interface DirectorySyncJob {
  jobCode: string
  providerCode: string
  syncType: string
  objectScope: string
  status: string
  startedAt: string | null
  finishedAt: string | null
  requestedBy: string | null
  totalCount: number
  createdCount: number
  updatedCount: number
  deletedCount: number
  skippedCount: number
  errorCount: number
  errorMessage: string | null
  createdAt: string
}

interface ApiResponse<T> {
  code: number
  data: T
}

const toast = useToast()
const { loaded: permissionsLoaded, loadPermissions, hasPermission } = usePermissions()
const running = ref(false)
const runningProvider = ref<string | null>(null)
const UBadge = resolveComponent('UBadge')
const UButton = resolveComponent('UButton')

if (!permissionsLoaded.value) {
  await loadPermissions()
}

const { data, pending, error, refresh } = await useFetch<ApiResponse<DirectorySyncJob[]>>('/api/v1/console/directory/sync-jobs', {
  query: { limit: 30 },
  default: () => ({ code: 0, data: [] })
})

const jobs = computed(() => data.value?.data || [])
const canRunSync = computed(() => permissionsLoaded.value && hasPermission('directory_sync', 'edit'))

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
    cell: ({ row }) => h('div', [
      h(UButton, {
        to: `/directory/sync/${row.original.jobCode}`,
        variant: 'link',
        color: 'primary',
        class: 'p-0 font-medium'
      }, () => row.original.jobCode),
      row.original.errorMessage
        ? h('p', { class: 'text-xs text-error' }, row.original.errorMessage)
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
    cell: ({ row }) => h('span', { class: 'text-muted' }, `${row.original.totalCount} total / ${row.original.errorCount} errors`)
  },
  {
    id: 'time',
    header: '时间',
    cell: ({ row }) => h('span', { class: 'text-muted' }, row.original.finishedAt || row.original.startedAt || row.original.createdAt)
  }
]

async function rebuildSubjectExports() {
  if (!canRunSync.value) {
    toast.add({
      title: '权限不足',
      description: '需要目录同步编辑权限。',
      color: 'warning'
    })
    return
  }

  running.value = true
  try {
    const result = await $fetch<ApiResponse<DirectorySyncJob>>('/api/v1/console/directory/sync-jobs', {
      method: 'POST',
      body: {
        providerCode: 'console',
        syncType: 'manual',
        objectScope: 'subjects'
      }
    })

    toast.add({
      title: 'Subject Export 已重建',
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

async function runProviderSync(providerCode: 'account' | 'wecom' | 'dingtalk' | 'ldap' | 'gitlab') {
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
      body: {
        providerCode,
        syncType: 'manual',
        objectScope: 'all'
      }
    })

    toast.add({
      title: '目录源同步已完成',
      description: `任务 ${result.data.jobCode}：共 ${result.data.totalCount} 条`,
      color: 'success'
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
            从 `directory_users / directory_departments / directory_projects` 生成最小 subject 投影，供 Platform subject sync 使用。
          </p>
          <template #footer>
            <UButton
              icon="i-lucide-play"
              :loading="running"
              :disabled="!canRunSync"
              @click="rebuildSubjectExports"
            >
              重建 subject export
            </UButton>
          </template>
        </UCard>

        <UCard>
          <template #header>
            <span class="font-semibold">外部目录源</span>
          </template>
          <p class="text-sm text-muted">
            Account、LDAP、企业微信、钉钉、GitLab 写入 Console Directory Runtime；外部源从 `integrations + vault` 读取配置。
          </p>
          <template #footer>
            <div class="flex flex-wrap gap-2">
              <UButton
                size="sm"
                variant="soft"
                icon="i-lucide-database-backup"
                :loading="runningProvider === 'account'"
                :disabled="!canRunSync"
                @click="runProviderSync('account')"
              >
                导入 Account
              </UButton>
              <UButton
                size="sm"
                variant="soft"
                icon="i-simple-icons-gitlab"
                :loading="runningProvider === 'gitlab'"
                :disabled="!canRunSync"
                @click="runProviderSync('gitlab')"
              >
                同步 GitLab
              </UButton>
              <UButton
                size="sm"
                variant="soft"
                icon="i-simple-icons-wechat"
                :loading="runningProvider === 'wecom'"
                :disabled="!canRunSync"
                @click="runProviderSync('wecom')"
              >
                同步企业微信
              </UButton>
              <UButton
                size="sm"
                variant="soft"
                icon="i-lucide-message-circle"
                :loading="runningProvider === 'dingtalk'"
                :disabled="!canRunSync"
                @click="runProviderSync('dingtalk')"
              >
                同步钉钉
              </UButton>
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

        <UTable
          sticky
          :data="jobs"
          :columns="jobColumns"
          :loading="pending"
          empty="暂无同步任务"
          class="flex-1 max-h-[calc(100svh-26rem)] rounded-lg border border-default"
        />
      </UCard>
    </template>
  </UDashboardPanel>
</template>
