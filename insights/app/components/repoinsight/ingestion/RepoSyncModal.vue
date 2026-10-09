<script setup lang="ts">
import { ref, reactive, computed, watch, nextTick, onMounted } from 'vue'
import type { RepoSummary } from '~/types/repoinsight'
import { extractErrorMessage, formatDate } from '~/utils/log'

const { apiBase } = useApiBase()

const props = defineProps<{
  open: boolean
  repos: RepoSummary[]
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'refresh'): void
}>()

const isOpen = computed({
  get: () => props.open,
  set: val => emit('update:open', val)
})

const toast = useToast()

// =============== 类型定义 ===============

type SummaryStatus = 'info' | 'success' | 'failed'

interface RepoSyncSummaryEntry {
  id: string
  repoId: number
  repoName: string
  repoKey: string
  sourceType: 'gitlab' | 'svn'
  status: SummaryStatus
  message: string
  timestamp: string
}

interface RepoSyncStatus {
  repo_key: string
  status: string
  processed_commits: number
  failed_commits: number
  message?: string | null
}

interface SyncResultPayload {
  repositories: RepoSyncStatus[]
  total_commits_processed: number
  total_commits_failed: number
  runIds?: number[]
}

type ScanStatus = 'idle' | 'running' | 'success' | 'failed'

// API response types
interface SyncRunFromDB {
  id: number
  job_type: string
  source_type: string | null
  repo_catalog_id: number | null
  repo_key: string | null
  status: string
  started_at: string | null
  finished_at: string | null
  items_processed: number | null
  items_failed: number | null
  error_message: string | null
}

interface SyncStatusResponse {
  hasRunning: boolean
  runs: SyncRunFromDB[]
  totalProcessed: number
  totalFailed: number
}

// =============== 状态管理 ===============

const bulkSyncSummaryLogs = ref<RepoSyncSummaryEntry[]>([])
const bulkSyncSummaryRef = ref<HTMLDivElement | null>(null)
const bulkSyncProgress = reactive({
  total: 0,
  completed: 0,
  failed: 0,
  totalCommits: 0,
  failedCommits: 0
})
const bulkSyncStatus = ref<ScanStatus>('idle')

// =============== 辅助函数 ===============

function scanStatusColor(status: ScanStatus) {
  if (status === 'success') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'running') return 'warning'
  return 'neutral'
}

function scanStatusLabel(status: ScanStatus) {
  if (status === 'success') return '已完成'
  if (status === 'failed') return '失败'
  if (status === 'running') return '进行中'
  return '未开始'
}

function summaryStatusLabel(status: SummaryStatus) {
  if (status === 'success') return '成功'
  if (status === 'failed') return '失败'
  return '进行中'
}

function formatRepoLabel(repoName?: string, repoKey?: string) {
  return repoName || repoKey || '未知仓库'
}

function resetBulkSummary() {
  bulkSyncSummaryLogs.value = []
  bulkSyncProgress.total = 0
  bulkSyncProgress.completed = 0
  bulkSyncProgress.failed = 0
  bulkSyncProgress.totalCommits = 0
  bulkSyncProgress.failedCommits = 0
  bulkSyncStatus.value = 'idle'
}

function appendBulkSummary(
  repo: { id: number, name?: string | null, repoKey: string },
  sourceType: 'gitlab' | 'svn',
  status: SummaryStatus,
  message: string
) {
  bulkSyncSummaryLogs.value = [
    ...bulkSyncSummaryLogs.value,
    {
      id: `${repo.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      repoId: repo.id,
      repoName: repo.name || '',
      repoKey: repo.repoKey,
      sourceType,
      status,
      message,
      timestamp: new Date().toISOString()
    }
  ]
}

// Load sync status from database
async function loadSyncStatus() {
  try {
    const response = await $fetch<SyncStatusResponse>(`${apiBase}/repos/sync-status`)
    if (!response || !response.runs || response.runs.length === 0) {
      return
    }

    // Convert DB runs to log entries
    const entries: RepoSyncSummaryEntry[] = []
    for (const run of response.runs) {
      const status: SummaryStatus = run.status === 'success'
        ? 'success'
        : run.status === 'failed'
          ? 'failed'
          : 'info'
      entries.push({
        id: `db-${run.id}`,
        repoId: run.repo_catalog_id || 0,
        repoName: '',
        repoKey: run.repo_key || '',
        sourceType: (run.source_type as 'gitlab' | 'svn') || 'gitlab',
        status,
        message: run.status === 'running'
          ? '同步中...'
          : `处理 ${run.items_processed || 0}，失败 ${run.items_failed || 0}`,
        timestamp: run.started_at || new Date().toISOString()
      })
    }

    // Update state from DB
    // If we have no repos from props (e.g., after page refresh), use DB runs count as total
    bulkSyncSummaryLogs.value = entries
    if (bulkSyncProgress.total === 0 && response.runs.length > 0) {
      bulkSyncProgress.total = response.runs.length
    }
    bulkSyncProgress.completed = response.runs.filter(r => r.status !== 'running').length
    bulkSyncProgress.failed = response.runs.filter(r => r.status === 'failed').length
    bulkSyncProgress.totalCommits = response.totalProcessed
    bulkSyncProgress.failedCommits = response.totalFailed
    bulkSyncStatus.value = response.hasRunning
      ? 'running'
      : response.runs.some(r => r.status === 'failed')
        ? 'failed'
        : response.runs.length > 0
          ? 'success'
          : 'idle'
  } catch (error) {
    console.error('Failed to load sync status:', error)
  }
}

// =============== 核心逻辑 ===============

async function runBulkSyncSequence(reposList: RepoSummary[]) {
  if (reposList.length === 0) {
    toast.add({
      title: '暂无有效仓库',
      description: '请在列表中启用需要同步的 GitLab 或 SVN 仓库。',
      color: 'warning'
    })
    return
  }
  resetBulkSummary()
  bulkSyncStatus.value = 'running'
  bulkSyncProgress.total = reposList.length
  for (const repo of reposList) {
    const repoInfo = { id: repo.id, name: repo.name, repoKey: repo.repoKey }
    const sourceType = repo.sourceType as 'gitlab' | 'svn'
    appendBulkSummary(repoInfo, sourceType, 'info', '开始同步...... ')
    try {
      const endpoint
        = sourceType === 'gitlab'
          ? `${apiBase}/ingestion/sync/gitlab`
          : `${apiBase}/ingestion/sync/svn`

      const payload = {
        include_invalid: true,
        includeInvalid: true, // Redundant fallback
        valid_only: false,
        repo_catalog_ids: [repo.id]
      }
      console.log('Sync payload:', payload)
      const result = await $fetch<SyncResultPayload>(endpoint, {
        method: 'POST',
        body: payload
      })
      const processed = result?.total_commits_processed ?? 0
      const failedCommits = result?.total_commits_failed ?? 0

      // Update commit counters
      bulkSyncProgress.totalCommits += processed
      bulkSyncProgress.failedCommits += failedCommits

      if (failedCommits > 0) {
        bulkSyncProgress.failed += 1
        appendBulkSummary(
          repoInfo,
          sourceType,
          'failed',
          `处理 ${processed}，失败 ${failedCommits}`
        )
      } else {
        appendBulkSummary(
          repoInfo,
          sourceType,
          'success',
          `处理 ${processed}，失败 ${failedCommits}`
        )
      }
    } catch (error) {
      bulkSyncProgress.failed += 1
      appendBulkSummary(
        repoInfo,
        sourceType,
        'failed',
        extractErrorMessage(error)
      )
    } finally {
      bulkSyncProgress.completed += 1
    }
  }
  bulkSyncStatus.value = bulkSyncProgress.failed > 0 ? 'failed' : 'success'
  toast.add({
    title: bulkSyncProgress.failed > 0 ? '同步完成（含失败）' : '同步完成',
    description: `共 ${bulkSyncProgress.total} 个仓库，失败 ${bulkSyncProgress.failed}`,
    color: bulkSyncProgress.failed > 0 ? 'warning' : 'success'
  })
  emit('refresh')
}

async function triggerRepoSync() {
  await runBulkSyncSequence(props.repos)
}

// =============== Watchers ===============

// Load sync status from database when modal opens
watch(isOpen, async (open) => {
  if (open) {
    await loadSyncStatus()
  }
})

// Also load on mount if already open
onMounted(async () => {
  if (isOpen.value) {
    await loadSyncStatus()
  }
})

watch(bulkSyncSummaryLogs, async () => {
  await nextTick()
  const container = bulkSyncSummaryRef.value
  if (container) {
    container.scrollTop = container.scrollHeight
  }
})
</script>

<template>
  <!-- 仓库同步对话框 -->
  <UModal
    v-model:open="isOpen"
    :ui="{ content: 'sm:max-w-4xl', footer: 'flex justify-end gap-2' }"
    title="版本记录同步"
    description="将有效仓库未入库的提交信息入库。关闭窗口不影响后台处理。"
  >
    <template #body>
      <div class="space-y-4">
        <div class="space-y-3 rounded border border-gray-200 p-3 text-sm dark:border-gray-700">
          <div class="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-500">
            <div>
              仓库进度：{{ bulkSyncProgress.completed }} / {{ bulkSyncProgress.total }}
              <span
                v-if="bulkSyncProgress.failed"
                class="ml-2 text-error-600"
              >
                失败 {{ bulkSyncProgress.failed }}
              </span>
              <span class="mx-2 text-muted-400">|</span>
              提交数：{{ bulkSyncProgress.totalCommits }}
              <span
                v-if="bulkSyncProgress.failedCommits"
                class="ml-1 text-error-600"
              >
                (失败 {{ bulkSyncProgress.failedCommits }})
              </span>
            </div>
            <UBadge
              :label="scanStatusLabel(bulkSyncStatus)"
              :color="scanStatusColor(bulkSyncStatus)"
              variant="soft"
            />
          </div>
          <div class="space-y-2 text-xs text-muted-500">
            <div
              ref="bulkSyncSummaryRef"
              class="h-48 overflow-y-auto rounded border border-dashed border-gray-200 bg-neutral-50 p-2 font-mono text-[12px] leading-5 dark:border-gray-800 dark:bg-neutral-900"
            >
              <div
                v-if="bulkSyncSummaryLogs.length === 0"
                class="px-1 text-muted-400"
              >
                尚未开始同步。
              </div>
              <div
                v-else
                class="space-y-1.5"
              >
                <div
                  v-for="entry in bulkSyncSummaryLogs"
                  :key="entry.id"
                  class="px-1 text-neutral-700 dark:text-neutral-200"
                >
                  <span class="text-muted-500">
                    {{ formatDate(entry.timestamp) }}
                  </span>
                  <span class="mx-1 text-muted-400">·</span>
                  <span class="text-muted-500">
                    {{ entry.sourceType === "gitlab" ? "GitLab" : "SVN" }}
                  </span>
                  <span class="mx-1 text-muted-400">·</span>
                  <span
                    :class="entry.status === 'success'
                      ? 'text-success-600 dark:text-success-400'
                      : entry.status === 'failed'
                        ? 'text-error-600'
                        : 'text-warning-600'
                    "
                  >
                    {{ summaryStatusLabel(entry.status) }}
                  </span>
                  <span class="mx-1 text-muted-400">—</span>
                  <span class="font-semibold">
                    {{ formatRepoLabel(entry.repoName, entry.repoKey) }}
                  </span>
                  <span class="text-muted-500"> : {{ entry.message }} </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          color="neutral"
          variant="subtle"
          @click="isOpen = false"
        >
          关闭窗口
        </UButton>
        <UButton
          color="primary"
          icon="i-lucide-play"
          :loading="bulkSyncStatus === 'running'"
          :disabled="bulkSyncStatus === 'running' || props.repos.length === 0"
          :label="bulkSyncStatus === 'running' ? '同步中...' : '开始同步'"
          @click="triggerRepoSync"
        />
      </div>
    </template>
  </UModal>
</template>
