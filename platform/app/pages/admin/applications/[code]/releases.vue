<script setup lang="ts">
import {
  formatDateTime,
  statusTone,
  type ApiEnvelope,
  type OpsApplication,
  type OpsApplicationList,
  type OpsRelease
} from '~/utils/opsConsole'

definePageMeta({
  layout: 'platform'
})

const route = useRoute()
const toast = useToast()
const code = computed(() => String(route.params.code))
const actionPending = ref<number | null>(null)
const importModalOpen = ref(false)

const appData = ref<ApiEnvelope<OpsApplicationList> | null>(null)
const releaseData = ref<ApiEnvelope<{ items: OpsRelease[] }> | null>(null)
const pending = ref(false)

async function refreshApp() {
  appData.value = await $fetch('/api/platform/ops/applications', {
    query: {
      appCode: code.value,
      pageSize: 1
    }
  }) as ApiEnvelope<OpsApplicationList>
}

async function refresh() {
  pending.value = true
  try {
    releaseData.value = await $fetch(`/api/platform/ops/applications/${code.value}/releases`) as ApiEnvelope<{ items: OpsRelease[] }>
  } finally {
    pending.value = false
  }
}

const app = computed<OpsApplication | null>(() => appData.value?.data.items[0] || null)

const statusItems = [
  { label: '状态：全部', value: 'all' },
  { label: 'released', value: 'released' },
  { label: 'ready', value: 'ready' },
  { label: 'draft', value: 'draft' },
  { label: 'deprecated', value: 'deprecated' }
]

const status = ref('all')
const q = ref('')
const releases = computed<OpsRelease[]>(() => {
  const term = q.value.trim().toLowerCase()
  const items = (releaseData.value?.data.items || []) as OpsRelease[]
  return items.filter((item) => {
    if (status.value !== 'all' && item.status !== status.value) return false
    if (term && !item.releaseVersion.toLowerCase().includes(term)) return false
    return true
  })
})

async function refreshAll() {
  await Promise.all([refresh(), refreshApp()])
}

watch(code, () => {
  void refreshAll()
})

await refreshAll()

async function setReleaseStatus(release: OpsRelease, nextStatus: string) {
  actionPending.value = release.id
  try {
    await $fetch(`/api/platform/ops/applications/${code.value}/releases/${release.id}`, {
      method: 'PATCH',
      body: { status: nextStatus }
    })
    await refreshAll()
    toast.add({
      title: 'Release 状态已更新',
      description: `${release.releaseVersion} -> ${nextStatus}`,
      color: 'success'
    })
  } catch (error) {
    toast.add({
      title: '状态更新失败',
      description: error instanceof Error ? error.message : '请稍后重试。',
      color: 'error'
    })
  } finally {
    actionPending.value = null
  }
}

function releaseMenuItems(release: OpsRelease) {
  return [[
    {
      label: '标记为 ready',
      icon: 'i-lucide-check-circle',
      disabled: release.status === 'ready',
      onSelect: () => setReleaseStatus(release, 'ready')
    },
    {
      label: '发布为 latest',
      icon: 'i-lucide-rocket',
      disabled: release.status === 'released',
      onSelect: () => setReleaseStatus(release, 'released')
    },
    {
      label: '退回 draft',
      icon: 'i-lucide-pencil',
      disabled: release.status === 'draft',
      onSelect: () => setReleaseStatus(release, 'draft')
    },
    {
      label: '标记 deprecated',
      icon: 'i-lucide-archive',
      disabled: release.status === 'deprecated',
      onSelect: () => setReleaseStatus(release, 'deprecated')
    }
  ]]
}
</script>

<template>
  <div
    v-if="app"
    style="margin-top: 16px"
  >
    <UCard :ui="{ body: 'p-0 sm:p-0' }">
      <div class="toolbar">
        <UInput
          v-model="q"
          icon="i-lucide-search"
          placeholder="搜索 version…"
          size="sm"
          class="w-full max-w-60"
        />
        <USelect
          v-model="status"
          :items="statusItems"
          size="sm"
          class="w-40"
        />
        <span class="grow" />
        <UButton
          size="sm"
          color="neutral"
          variant="outline"
          icon="i-lucide-refresh-cw"
          :loading="pending"
          @click="importModalOpen = true"
        >
          从 GitLab 拉取
        </UButton>
        <UButton
          color="primary"
          size="sm"
          icon="i-lucide-plus"
          @click="importModalOpen = true"
        >
          新建 Release
        </UButton>
      </div>
      <table class="tbl">
        <thead>
          <tr>
            <th>Version</th>
            <th>状态</th>
            <th>Manifest</th>
            <th>作者</th>
            <th>创建时间</th>
            <th>说明</th>
            <th class="row-actions" />
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="r in releases"
            :key="r.id"
          >
            <td>
              <div
                class="row"
                style="gap: 8px"
              >
                <UIcon
                  name="i-lucide-tag"
                  style="width: 14px; height: 14px; color: var(--fg-muted)"
                />
                <span
                  class="mono"
                  style="color: var(--fg); font-weight: 500"
                >
                  {{ r.releaseVersion }}
                </span>
                <UBadge
                  v-if="r.isLatestReleased"
                  color="info"
                  variant="soft"
                  size="sm"
                >
                  latest
                </UBadge>
              </div>
            </td>
            <td>
              <UBadge
                :color="statusTone(r.status)"
                variant="soft"
                size="sm"
              >
                <template #leading>
                  <span class="size-1.5 rounded-full bg-current" />
                </template>
                {{ r.status }}
              </UBadge>
            </td>
            <td>
              <span class="code-chip">seq #{{ r.manifestSeq }}</span>
            </td>
            <td
              class="mono"
              style="font-size: 12px"
            >
              {{ r.sourceTag }}
            </td>
            <td class="muted">
              {{ formatDateTime(r.createdAt) }}
            </td>
            <td
              class="muted"
              style="max-width: 280px"
            >
              {{ r.missingGrantActionCount ? `${r.missingGrantActionCount} 个授权动作未覆盖` : r.manifestHash }}
            </td>
            <td class="row-actions">
              <UDropdownMenu :items="releaseMenuItems(r)">
                <UButton
                  color="neutral"
                  variant="ghost"
                  size="sm"
                  icon="i-lucide-ellipsis"
                  :loading="actionPending === r.id"
                  square
                />
              </UDropdownMenu>
            </td>
          </tr>
        </tbody>
      </table>
    </UCard>

    <div style="margin-top: 14px; padding: 12px 14px; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; display: flex; align-items: center; gap: 10px">
      <UIcon
        name="i-lucide-sparkles"
        style="width: 14px; height: 14px; color: var(--brand)"
      />
      <div style="font-size: 13px; color: var(--fg-muted); flex: 1">
        <span style="color: var(--fg); font-weight: 500">状态流转：</span>
        <span
          class="mono"
          style="color: var(--fg)"
        >draft</span>
        <UIcon
          name="i-lucide-chevron-right"
          style="width: 11px; height: 11px; vertical-align: middle; margin: 0 2px; color: var(--fg-subtle)"
        />
        <span
          class="mono"
          style="color: var(--fg)"
        >ready</span>
        <UIcon
          name="i-lucide-chevron-right"
          style="width: 11px; height: 11px; vertical-align: middle; margin: 0 2px; color: var(--fg-subtle)"
        />
        <span
          class="mono"
          style="color: var(--fg)"
        >released</span>
        <UIcon
          name="i-lucide-chevron-right"
          style="width: 11px; height: 11px; vertical-align: middle; margin: 0 2px; color: var(--fg-subtle)"
        />
        <span
          class="mono"
          style="color: var(--fg)"
        >deprecated</span>
        <span style="margin-left: 10px">· 只有 released 的版本会向订阅租户可见。</span>
      </div>
    </div>

    <AppGitLabReleaseImportModal
      v-model:open="importModalOpen"
      :app-code="code"
      :repo-url="app.repoUrl"
      @imported="refreshAll"
    />
  </div>
</template>
