<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import {
  applyRuntimeReleaseApproval,
  isRuntimeReleaseApprovalObserved,
  type RuntimeReleaseApprovalResult
} from '~/utils/runtimeReleaseApproval'

definePageMeta({ layout: 'platform' })
usePageTitle('Runtime 发布')

interface ReleaseItem {
  id: number
  version: string
  commit: string
  builtAt: string
  manifestHash: string
  releaseSigningKeyId: string
  status: string
  discoveredAt: string
  approvedAt: string | null
  approvalKind: 'promotion' | 'rollback' | null
  approvalNote: string | null
  approved: boolean
}

interface RuntimeReleaseResponse {
  channel: {
    code: string
    approvedVersion: string
    approvalKind: string
    approvedAt: string | null
    source: 'registry' | 'bootstrap'
  }
  trust: { releaseSigningKeyId: string, packageBaseUrl: string }
  latestPackage: {
    available: boolean
    version?: string
    commit?: string
    builtAt?: string
    manifestHash?: string
    releaseSigningKeyId?: string
    synchronized?: boolean
    error?: string
  }
  releases: { items: ReleaseItem[], total: number, page: number, pageSize: number }
  instances: {
    total: number
    aligned: number
    pending: number
    versions: Array<{ currentVersion: string | null, desiredVersion: string, status: string, count: number }>
  }
}

interface ApiEnvelope<T> { success: true, data: T }

interface ApprovalResponse {
  version: string
  previousVersion: string | null
  approvalKind: 'promotion' | 'rollback'
  approvedAt: string
  isRollback: boolean
  updatedInstances: number
}

const toast = useToast()
const { confirm } = useConfirm()
const data = ref<RuntimeReleaseResponse | null>(null)
const pending = ref(false)
const actionPending = ref('')
const error = ref<unknown>(null)
const importOpen = ref(false)
const importVersion = ref('')
const approvalNote = ref('')
const acknowledgedApproval = ref<RuntimeReleaseApprovalResult | null>(null)
const page = ref(1)
const pageSize = 20

const releases = computed(() => data.value?.releases.items || [])
const total = computed(() => data.value?.releases.total || 0)
const channel = computed(() => data.value?.channel || null)
const latest = computed(() => data.value?.latestPackage || null)
const instances = computed(() => data.value?.instances || { total: 0, aligned: 0, pending: 0, versions: [] })
const columns: TableColumn<ReleaseItem>[] = [
  { id: 'version', header: '版本' },
  { id: 'build', header: '构建信息' },
  { id: 'trust', header: '签名与 Manifest' },
  { id: 'status', header: '渠道状态' },
  { id: 'actions', header: '' }
]

function formatDateTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN')
}

function shortHash(value?: string | null) {
  if (!value) return '—'
  return value.length > 16 ? `${value.slice(0, 12)}…${value.slice(-4)}` : value
}

function versionParts(version: string) {
  return version.split('-')[0]?.split('.').map(item => Number(item)) || []
}

function isRollback(version: string) {
  const current = channel.value?.approvedVersion
  if (!current) return false
  const left = versionParts(version)
  const right = versionParts(current)
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] || 0) === (right[index] || 0)) continue
    return (left[index] || 0) < (right[index] || 0)
  }
  return false
}

function responseError(caught: unknown, fallback: string) {
  if (caught && typeof caught === 'object') {
    const apiError = caught as { data?: { message?: string }, message?: string }
    return apiError.data?.message || apiError.message || fallback
  }
  return fallback
}

async function refresh() {
  pending.value = true
  error.value = null
  try {
    const response = await platformFetchJson<ApiEnvelope<RuntimeReleaseResponse>>('/api/platform/ops/runtime-releases', {
      query: { page: page.value, pageSize, _ts: Date.now() },
      cache: 'no-store'
    })
    if (acknowledgedApproval.value && !isRuntimeReleaseApprovalObserved(response.data, acknowledgedApproval.value)) {
      data.value = applyRuntimeReleaseApproval(response.data, acknowledgedApproval.value)
    } else {
      data.value = response.data
      acknowledgedApproval.value = null
    }
  } catch (caught) {
    error.value = caught
  } finally {
    pending.value = false
  }
}

async function synchronize(version: string) {
  actionPending.value = `sync:${version}`
  try {
    const response = await platformFetchJson<ApiEnvelope<{ release: ReleaseItem }>>('/api/platform/ops/runtime-releases/sync', {
      method: 'POST',
      body: { version }
    })
    importOpen.value = false
    importVersion.value = ''
    toast.add({
      title: 'Runtime 版本已同步',
      description: response.data.release?.version || version,
      color: 'success'
    })
    page.value = 1
    await refresh()
  } catch (caught) {
    toast.add({ title: 'Runtime 版本同步失败', description: responseError(caught, '请稍后重试。'), color: 'error' })
  } finally {
    actionPending.value = ''
  }
}

async function approve(release: ReleaseItem) {
  if (release.approved) return
  const rollback = isRollback(release.version)
  const accepted = await confirm({
    title: rollback ? '确认回滚 Runtime' : '批准 Runtime 版本',
    message: rollback
      ? `稳定渠道将从 ${channel.value?.approvedVersion} 回滚到 ${release.version}。在线 Agent 将在心跳后收到降级目标，请确认已评估数据兼容性。`
      : `稳定渠道将批准 ${release.version}，并立即更新企业 Runtime 的升级目标。`,
    confirmLabel: rollback ? '确认回滚' : '批准上线',
    tone: 'warning',
    color: rollback ? 'warning' : 'primary',
    icon: rollback ? 'i-lucide-rotate-ccw' : 'i-lucide-badge-check'
  })
  if (!accepted) return

  actionPending.value = `approve:${release.version}`
  try {
    const note = approvalNote.value.trim() || null
    const response = await platformFetchJson<ApiEnvelope<ApprovalResponse>>('/api/platform/ops/runtime-releases/approve', {
      method: 'POST',
      body: {
        version: release.version,
        note: note || undefined,
        confirmRollback: rollback
      }
    })
    acknowledgedApproval.value = { ...response.data, note }
    if (data.value) {
      data.value = applyRuntimeReleaseApproval(data.value, acknowledgedApproval.value)
    }
    approvalNote.value = ''
    toast.add({
      title: rollback ? 'Runtime 回滚已批准' : 'Runtime 版本已批准',
      description: `${release.version} · 已更新 ${response.data.updatedInstances} 个 Runtime 目标`,
      color: rollback ? 'warning' : 'success'
    })
    await refresh()
  } catch (caught) {
    toast.add({ title: 'Runtime 版本批准失败', description: responseError(caught, '请稍后重试。'), color: 'error' })
  } finally {
    actionPending.value = ''
  }
}

watch(page, () => void refresh())
await refresh()
</script>

<template>
  <div>
    <div class="page-h">
      <div>
        <h1>Runtime 发布</h1>
        <p>同步已签名的 Data Runtime 制品，并动态批准稳定渠道版本。</p>
      </div>
      <div class="page-h-actions">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-refresh-cw"
          :loading="pending"
          @click="refresh"
        >
          刷新
        </UButton>
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-file-input"
          @click="importOpen = true"
        >
          同步指定版本
        </UButton>
        <UButton
          color="primary"
          icon="i-lucide-cloud-download"
          :loading="actionPending === 'sync:latest'"
          :disabled="latest?.available === false"
          @click="synchronize('latest')"
        >
          同步 latest
        </UButton>
      </div>
    </div>

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      title="Runtime 发布信息加载失败"
      :description="responseError(error, '请检查数据库迁移和发布源配置。')"
      class="mb-4"
    />
    <UAlert
      v-else-if="channel?.source === 'bootstrap'"
      color="warning"
      variant="soft"
      icon="i-lucide-triangle-alert"
      title="当前仍使用环境变量兜底版本"
      description="同步并批准一个版本后，Runtime 目标版本将切换为数据库中的稳定渠道，不再依赖 Platform Worker 重新部署。"
      class="mb-4"
    />

    <div class="grid gap-4 lg:grid-cols-3">
      <UCard>
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-sm text-muted">
              稳定渠道
            </div>
            <div class="mt-2 font-mono text-2xl font-semibold text-highlighted">
              {{ channel?.approvedVersion || '—' }}
            </div>
          </div>
          <UBadge
            :color="channel?.source === 'registry' ? 'success' : 'warning'"
            variant="soft"
          >
            {{ channel?.source === 'registry' ? '动态批准' : '配置兜底' }}
          </UBadge>
        </div>
        <div class="mt-4 text-xs text-muted">
          {{ channel?.approvalKind === 'rollback' ? '显式回滚' : '版本提升' }} · {{ formatDateTime(channel?.approvedAt) }}
        </div>
      </UCard>

      <UCard>
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-sm text-muted">
              制品仓库 latest
            </div>
            <div class="mt-2 font-mono text-2xl font-semibold text-highlighted">
              {{ latest?.available ? latest.version : '不可用' }}
            </div>
          </div>
          <UBadge
            :color="latest?.available ? (latest.synchronized ? 'success' : 'info') : 'error'"
            variant="soft"
          >
            {{ latest?.available ? (latest.synchronized ? '已同步' : '待同步') : '读取失败' }}
          </UBadge>
        </div>
        <div
          class="mt-4 truncate text-xs text-muted"
          :title="latest?.error || latest?.commit"
        >
          {{ latest?.available ? `${latest.commit} · ${formatDateTime(latest.builtAt)}` : latest?.error }}
        </div>
      </UCard>

      <UCard>
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-sm text-muted">
              Runtime 实例
            </div>
            <div class="mt-2 text-2xl font-semibold text-highlighted">
              {{ instances.aligned }} / {{ instances.total }}
            </div>
          </div>
          <UBadge
            :color="instances.pending > 0 ? 'warning' : 'success'"
            variant="soft"
          >
            {{ instances.pending > 0 ? `${instances.pending} 个待更新` : '全部一致' }}
          </UBadge>
        </div>
        <div class="mt-4 text-xs text-muted">
          按 Agent 最近一次心跳版本统计
        </div>
      </UCard>
    </div>

    <UCard
      class="mt-4"
      :ui="{ body: 'p-0 sm:p-0' }"
    >
      <template #header>
        <div class="flex flex-wrap items-center gap-3">
          <div>
            <div class="font-medium text-highlighted">
              已同步版本
            </div>
            <div class="text-xs text-muted">
              批准操作只移动稳定渠道指针，不重新部署 Platform。
            </div>
          </div>
          <span class="grow" />
          <UInput
            v-model="approvalNote"
            placeholder="批准说明（可选）"
            size="sm"
            class="w-full sm:w-72"
          />
        </div>
      </template>

      <UEmpty
        v-if="!pending && releases.length === 0"
        icon="i-lucide-package-open"
        title="尚未同步 Runtime 版本"
        description="先同步 latest 或输入一个已发布的精确版本。"
        class="py-14"
      />
      <UTable
        v-else
        :data="releases"
        :columns="columns"
        :loading="pending"
        :ui="{ root: 'overflow-x-auto', th: 'whitespace-nowrap bg-muted/40 text-xs font-medium text-muted', td: 'whitespace-nowrap text-sm' }"
      >
        <template #version-cell="{ row }">
          <div class="flex items-center gap-2">
            <span class="font-mono font-semibold text-highlighted">{{ row.original.version }}</span>
            <UBadge
              v-if="row.original.approved"
              color="success"
              variant="soft"
              size="sm"
            >
              stable
            </UBadge>
          </div>
        </template>
        <template #build-cell="{ row }">
          <div class="font-mono text-xs text-highlighted">
            {{ row.original.commit }}
          </div>
          <div class="text-xs text-muted">
            {{ formatDateTime(row.original.builtAt) }}
          </div>
        </template>
        <template #trust-cell="{ row }">
          <div
            class="font-mono text-xs"
            :title="row.original.manifestHash"
          >
            Manifest {{ shortHash(row.original.manifestHash) }}
          </div>
          <div
            class="font-mono text-xs text-muted"
            :title="row.original.releaseSigningKeyId"
          >
            Key {{ shortHash(row.original.releaseSigningKeyId) }}
          </div>
        </template>
        <template #status-cell="{ row }">
          <UBadge
            :color="row.original.approved ? 'success' : 'neutral'"
            variant="soft"
          >
            {{ row.original.approved ? (row.original.approvalKind === 'rollback' ? '回滚目标' : '已批准') : '可批准' }}
          </UBadge>
        </template>
        <template #actions-cell="{ row }">
          <div class="flex justify-end">
            <UButton
              v-if="!row.original.approved"
              :color="isRollback(row.original.version) ? 'warning' : 'primary'"
              :variant="isRollback(row.original.version) ? 'soft' : 'outline'"
              size="sm"
              :icon="isRollback(row.original.version) ? 'i-lucide-rotate-ccw' : 'i-lucide-badge-check'"
              :loading="actionPending === `approve:${row.original.version}`"
              @click="approve(row.original)"
            >
              {{ isRollback(row.original.version) ? '回滚到此版本' : '批准上线' }}
            </UButton>
          </div>
        </template>
      </UTable>

      <div
        v-if="releases.length > 0"
        class="tbl-foot"
      >
        <span>共 <b class="font-semibold text-highlighted">{{ total }}</b> 个版本</span>
        <UPagination
          v-model:page="page"
          :total="total"
          :items-per-page="pageSize"
          size="sm"
          variant="ghost"
          color="neutral"
          :show-edges="false"
        />
      </div>
    </UCard>

    <UModal
      v-model:open="importOpen"
      title="同步指定 Runtime 版本"
      description="Platform 会从制品仓库读取 Manifest，并使用当前信任锚验证 Ed25519 签名。"
    >
      <template #body>
        <UFormField
          label="精确版本"
          hint="例如 0.3.137"
          required
        >
          <UInput
            v-model="importVersion"
            placeholder="0.3.137"
            class="w-full"
            autofocus
            @keyup.enter="importVersion.trim() && synchronize(importVersion.trim())"
          />
        </UFormField>
      </template>
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            @click="importOpen = false"
          >
            取消
          </UButton>
          <UButton
            color="primary"
            icon="i-lucide-cloud-download"
            :disabled="!importVersion.trim()"
            :loading="actionPending === `sync:${importVersion.trim()}`"
            @click="synchronize(importVersion.trim())"
          >
            验签并同步
          </UButton>
        </div>
      </template>
    </UModal>
  </div>
</template>
