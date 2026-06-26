<script setup lang="ts">
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('数据运行时')

type ApiResponse<T> = {
  code: number
  data: T
  message?: string
}

type RuntimeManifest = {
  name: string
  version: string
  commit: string | null
  builtAt: string | null
  publishedAt: string | null
  platforms: Array<{
    os: string
    arch: string
  }>
}

type RuntimeHealth = {
  reachable: boolean
  healthPath: string | null
  status: string
  version: string | null
  commit: string | null
  builtAt: string | null
  tenant: string | null
  deployment: string | null
  apps: Record<string, unknown>
  error: string | null
  checkedAt: string
}

type DataRuntimeOverview = {
  parameters: {
    runtimeApiUrl: string
    packageBaseUrl: string
    audience: string
    tokenConfigured: boolean
  }
  latest: {
    manifest: RuntimeManifest | null
    manifestUrl: string
    versionUrl: string
    fetchedAt: string
    error: string | null
  }
  runtime: RuntimeHealth
  updateAvailable: boolean
}

type RuntimeUpdateStatus = {
  status: string
  running: boolean
  targetVersion: string | null
  baseUrl: string | null
  serviceName: string | null
  restart: boolean | null
  triggeredAt: string | null
  startedAt: string | null
  finishedAt: string | null
  error: string | null
  result: Record<string, unknown> | null
  checkedAt: string
  audience: string | null
}

type UpdateTriggerResponse = {
  code: number
  data: {
    targetVersion: string
    runtimeApiUrl: string
    updateAvailable: boolean
    audience: string | null
    result: Record<string, unknown>
  }
}

type UpdateStatusResponse = {
  code: number
  data: RuntimeUpdateStatus
}

const toast = useToast()
const saving = ref(false)
const updating = ref(false)
const runtimeApiUrl = ref('')
const packageBaseUrl = ref('')
const audience = ref('')
const updateStatus = ref<RuntimeUpdateStatus | null>(null)
const updateError = ref('')
let updatePollTimer: ReturnType<typeof setInterval> | null = null
let updatePollAttempts = 0
const { loaded: permissionsLoaded, loadPermissions, hasPermission } = usePermissions()

if (!permissionsLoaded.value) {
  await loadPermissions()
}

const canEditSettings = computed(() => permissionsLoaded.value && hasPermission('system_settings', 'edit'))

const { data, pending, refresh } = await useFetch<ApiResponse<DataRuntimeOverview>>(
  '/api/v1/console/data-runtime/status',
  {
    default: () => ({
      code: 0,
      data: {
        parameters: {
          runtimeApiUrl: '',
          packageBaseUrl: 'https://downloads.huizhi.yun/packages/hzy-data-runtime',
          audience: 'data-runtime',
          tokenConfigured: false
        },
        latest: {
          manifest: null,
          manifestUrl: '',
          versionUrl: '',
          fetchedAt: '',
          error: null
        },
        runtime: {
          reachable: false,
          healthPath: null,
          status: 'unconfigured',
          version: null,
          commit: null,
          builtAt: null,
          tenant: null,
          deployment: null,
          apps: {},
          error: null,
          checkedAt: ''
        },
        updateAvailable: false
      }
    })
  }
)

const overview = computed(() => data.value?.data)
const latest = computed(() => overview.value?.latest.manifest || null)
const runtime = computed(() => overview.value?.runtime)
const runtimeApps = computed(() => Object.entries(runtime.value?.apps || {}).map(([code, value]) => ({
  code,
  value: value && typeof value === 'object' ? value as Record<string, unknown> : {}
})))
const headerLabel = computed(() => {
  if (overview.value?.updateAvailable) return '可更新'
  if (runtime.value?.reachable) return '运行中'
  if (runtimeApiUrl.value) return '不可达'
  return '未配置'
})
const headerColor = computed(() => {
  if (overview.value?.updateAvailable) return 'warning' as const
  if (runtime.value?.reachable) return 'success' as const
  return 'neutral' as const
})

watch(overview, (value) => {
  runtimeApiUrl.value = value?.parameters.runtimeApiUrl || ''
  packageBaseUrl.value = value?.parameters.packageBaseUrl || 'https://downloads.huizhi.yun/packages/hzy-data-runtime'
  audience.value = value?.parameters.audience || 'data-runtime'
}, { immediate: true })

onBeforeUnmount(() => {
  stopUpdatePolling()
})

function errorMessage(error: unknown) {
  const normalized = error as { data?: { message?: string }, message?: string }
  return normalized.data?.message || normalized.message || String(error)
}

function display(value: unknown) {
  const text = String(value || '').trim()
  return text || '-'
}

function shortCommit(value: string | null | undefined) {
  if (!value) return '-'
  return value.length > 12 ? value.slice(0, 12) : value
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date)
}

function appStatusLabel(app: Record<string, unknown>) {
  if (app.enabled === false) return '未启用'
  if (app.db === 'ok') return '正常'
  if (app.db === 'unavailable') return '异常'
  return app.enabled ? '已启用' : '未知'
}

function appStatusColor(app: Record<string, unknown>) {
  if (app.enabled === false) return 'neutral' as const
  if (app.db === 'ok') return 'success' as const
  if (app.db === 'unavailable') return 'error' as const
  return 'warning' as const
}

function isActiveUpdateStatus(status: string | null | undefined, running = false) {
  return running || ['running', 'accepted', 'queued'].includes(status || '')
}

const updateStatusColor = computed(() => {
  if (updateError.value || updateStatus.value?.status === 'failed') return 'error' as const
  if (isActiveUpdateStatus(updateStatus.value?.status, updateStatus.value?.running)) return 'warning' as const
  if (updateStatus.value?.status === 'succeeded') return 'success' as const
  return 'neutral' as const
})

const updateStatusTitle = computed(() => {
  if (updateError.value) return '更新触发失败'
  if (updateStatus.value?.status === 'failed') return '租户运行时更新失败'
  if (isActiveUpdateStatus(updateStatus.value?.status, updateStatus.value?.running)) return '租户运行时更新已提交'
  if (updateStatus.value?.status === 'succeeded') return '租户运行时更新完成'
  return '租户运行时更新状态'
})

const updateStatusDescription = computed(() => {
  if (updateError.value) return updateError.value
  const status = updateStatus.value
  if (!status) return ''
  if (status.error) return status.error
  const result = status.result || {}
  const currentVersion = display(result.currentVersion)
  const availableVersion = display(result.availableVersion)
  if (status.status === 'succeeded') {
    return `当前版本 ${currentVersion}，目标版本 ${availableVersion}，重启${result.restarted ? '已完成' : '未执行或不需要'}`
  }
  if (isActiveUpdateStatus(status.status, status.running)) {
    return `已通过 API 提交到租户 Linux data-runtime，目标版本 ${display(status.targetVersion)}，使用 audience ${display(status.audience)}`
  }
  return `最近检测：${formatDate(status.checkedAt)}`
})

function stopUpdatePolling() {
  if (updatePollTimer) {
    clearInterval(updatePollTimer)
    updatePollTimer = null
  }
}

async function loadUpdateStatus(silent = false) {
  if (!canEditSettings.value) return
  try {
    const response = await $fetch<UpdateStatusResponse>('/api/v1/console/data-runtime/update-status')
    updateStatus.value = response.data
    updateError.value = ''
    if (!isActiveUpdateStatus(response.data.status, response.data.running)) {
      stopUpdatePolling()
      await refresh()
    }
  } catch (error) {
    if (!silent) {
      updateError.value = errorMessage(error)
    }
  }
}

function startUpdatePolling() {
  stopUpdatePolling()
  updatePollAttempts = 0
  updatePollTimer = setInterval(() => {
    updatePollAttempts += 1
    void loadUpdateStatus(updatePollAttempts > 1)
    if (updatePollAttempts >= 20) {
      stopUpdatePolling()
    }
  }, 3000)
}

async function saveParameters() {
  if (!canEditSettings.value) {
    toast.add({ color: 'error', title: '无权限', description: '需要系统参数编辑权限' })
    return
  }
  saving.value = true
  try {
    await Promise.all([
      $fetch('/api/v1/console/settings/values/dataRuntime.runtimeApiUrl', {
        method: 'PUT',
        body: { value: runtimeApiUrl.value.trim() }
      }),
      $fetch('/api/v1/console/settings/values/dataRuntime.packageBaseUrl', {
        method: 'PUT',
        body: { value: packageBaseUrl.value.trim() }
      }),
      $fetch('/api/v1/console/settings/values/dataRuntime.audience', {
        method: 'PUT',
        body: { value: audience.value.trim() }
      })
    ])
    await refresh()
    toast.add({ color: 'success', title: '已保存', description: '数据运行时参数已更新' })
  } catch (error) {
    toast.add({ color: 'error', title: '保存失败', description: errorMessage(error) })
  } finally {
    saving.value = false
  }
}

async function triggerUpdate() {
  if (!canEditSettings.value) {
    toast.add({ color: 'error', title: '无权限', description: '需要系统参数编辑权限' })
    return
  }
  updating.value = true
  updateError.value = ''
  try {
    const response = await $fetch<UpdateTriggerResponse>('/api/v1/console/data-runtime/update', { method: 'POST' })
    updateStatus.value = {
      status: String(response.data.result.status || 'running'),
      running: ['running', 'accepted', 'queued'].includes(String(response.data.result.status || 'running')),
      targetVersion: String(response.data.result.targetVersion || response.data.targetVersion || ''),
      baseUrl: String(response.data.result.baseUrl || ''),
      serviceName: String(response.data.result.serviceName || ''),
      restart: typeof response.data.result.restart === 'boolean' ? response.data.result.restart : null,
      triggeredAt: String(response.data.result.triggeredAt || ''),
      startedAt: String(response.data.result.startedAt || response.data.result.triggeredAt || ''),
      finishedAt: null,
      error: null,
      result: null,
      checkedAt: new Date().toISOString(),
      audience: response.data.audience
    }
    toast.add({ color: 'success', title: '更新已触发', description: `目标版本 ${latest.value?.version || 'latest'}` })
    startUpdatePolling()
    await refresh()
  } catch (error) {
    updateError.value = errorMessage(error)
    toast.add({ color: 'error', title: '触发失败', description: updateError.value })
  } finally {
    updating.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="data-runtime" :ui="dashboardPanelUi">
    <template #header>
      <UDashboardNavbar title="数据运行时">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UBadge :color="headerColor" variant="subtle">
            {{ headerLabel }}
          </UBadge>
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="soft"
            aria-label="刷新"
            title="刷新"
            :loading="pending"
            @click="refresh()"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="space-y-4">
        <div class="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
          <div class="rounded-lg border border-default bg-default p-4">
            <div class="mb-3 flex items-center justify-between gap-3">
              <h2 class="text-sm font-semibold text-highlighted">
                平台最新版本
              </h2>
              <UBadge color="neutral" variant="subtle">
                {{ latest?.name || 'hzy-data-runtime' }}
              </UBadge>
            </div>

            <dl class="grid grid-cols-[6rem_1fr] gap-2 text-sm">
              <dt class="text-muted">
                版本号
              </dt>
              <dd class="font-mono text-highlighted">
                {{ display(latest?.version) }}
              </dd>
              <dt class="text-muted">
                发布时间
              </dt>
              <dd>{{ formatDate(latest?.publishedAt || latest?.builtAt) }}</dd>
              <dt class="text-muted">
                Commit
              </dt>
              <dd class="font-mono">
                {{ shortCommit(latest?.commit) }}
              </dd>
              <dt class="text-muted">
                平台
              </dt>
              <dd>
                <div class="flex flex-wrap gap-1">
                  <UBadge
                    v-for="platform in latest?.platforms || []"
                    :key="`${platform.os}-${platform.arch}`"
                    color="neutral"
                    variant="soft"
                  >
                    {{ platform.os }}/{{ platform.arch }}
                  </UBadge>
                  <span v-if="!latest?.platforms?.length" class="text-muted">-</span>
                </div>
              </dd>
              <dt class="text-muted">
                Manifest
              </dt>
              <dd class="break-all font-mono text-xs">
                {{ overview?.latest.manifestUrl || '-' }}
              </dd>
            </dl>

            <UAlert
              v-if="overview?.latest.error"
              class="mt-3"
              color="warning"
              variant="soft"
              icon="i-lucide-triangle-alert"
              :description="overview.latest.error"
            />
          </div>

          <div class="rounded-lg border border-default bg-default p-4">
            <div class="mb-3 flex items-center justify-between gap-3">
              <h2 class="text-sm font-semibold text-highlighted">
                运行参数
              </h2>
              <UButton
                icon="i-lucide-save"
                color="primary"
                variant="subtle"
                aria-label="保存参数"
                title="保存参数"
                :loading="saving"
                :disabled="!canEditSettings"
                @click="saveParameters"
              />
            </div>

            <div class="grid gap-3 lg:grid-cols-2">
              <UFormField label="Runtime 地址">
                <UInput
                  v-model="runtimeApiUrl"
                  type="url"
                  placeholder="https://runtime.example.com"
                  class="w-full"
                  :disabled="!canEditSettings"
                  @keyup.enter="saveParameters"
                />
              </UFormField>
              <UFormField label="下载地址">
                <UInput
                  v-model="packageBaseUrl"
                  type="url"
                  class="w-full"
                  :disabled="!canEditSettings"
                  @keyup.enter="saveParameters"
                />
              </UFormField>
              <UFormField label="Token Audience">
                <UInput
                  v-model="audience"
                  class="w-full"
                  :disabled="!canEditSettings"
                  @keyup.enter="saveParameters"
                />
              </UFormField>
              <UFormField label="访问凭证">
                <div class="flex h-8 items-center">
                  <UBadge :color="overview?.parameters.tokenConfigured ? 'success' : 'neutral'" variant="subtle">
                    {{ overview?.parameters.tokenConfigured ? '已配置静态凭证' : '使用 Console service token' }}
                  </UBadge>
                </div>
              </UFormField>
            </div>
          </div>
        </div>

        <div class="rounded-lg border border-default bg-default p-4">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <h2 class="text-sm font-semibold text-highlighted">
                租户运行时
              </h2>
              <UBadge :color="runtime?.reachable ? 'success' : 'error'" variant="subtle">
                {{ runtime?.reachable ? runtime.status : '不可达' }}
              </UBadge>
            </div>
            <UButton
              v-if="overview?.updateAvailable"
              icon="i-lucide-upload-cloud"
              color="warning"
              :loading="updating"
              :disabled="!canEditSettings"
              @click="triggerUpdate"
            >
              更新版本
            </UButton>
          </div>

          <div class="grid gap-4 xl:grid-cols-[1fr_1fr]">
            <dl class="grid grid-cols-[6rem_1fr] gap-2 text-sm">
              <dt class="text-muted">
                当前版本
              </dt>
              <dd class="font-mono text-highlighted">
                {{ display(runtime?.version) }}
              </dd>
              <dt class="text-muted">
                构建时间
              </dt>
              <dd>{{ formatDate(runtime?.builtAt) }}</dd>
              <dt class="text-muted">
                Commit
              </dt>
              <dd class="font-mono">
                {{ shortCommit(runtime?.commit) }}
              </dd>
              <dt class="text-muted">
                Tenant
              </dt>
              <dd class="font-mono">
                {{ display(runtime?.tenant) }}
              </dd>
              <dt class="text-muted">
                Deployment
              </dt>
              <dd class="font-mono">
                {{ display(runtime?.deployment) }}
              </dd>
              <dt class="text-muted">
                Health
              </dt>
              <dd class="font-mono">
                {{ runtime?.healthPath || '-' }}
              </dd>
              <dt class="text-muted">
                检测时间
              </dt>
              <dd>{{ formatDate(runtime?.checkedAt) }}</dd>
            </dl>

            <div>
              <div class="mb-2 text-xs font-medium text-muted">
                Adapter 状态
              </div>
              <div class="grid gap-2 sm:grid-cols-2">
                <div
                  v-for="app in runtimeApps"
                  :key="app.code"
                  class="rounded-md border border-default bg-muted/30 p-3"
                >
                  <div class="flex items-center justify-between gap-2">
                    <span class="font-mono text-sm text-highlighted">{{ app.code }}</span>
                    <UBadge :color="appStatusColor(app.value)" variant="soft" size="sm">
                      {{ appStatusLabel(app.value) }}
                    </UBadge>
                  </div>
                  <p v-if="app.value.error" class="mt-2 break-all text-xs text-error">
                    {{ app.value.error }}
                  </p>
                </div>
                <div
                  v-if="!runtimeApps.length"
                  class="rounded-md border border-dashed border-default bg-muted/20 p-3 text-sm text-muted"
                >
                  -
                </div>
              </div>
            </div>
          </div>

          <UAlert
            v-if="runtime?.error"
            class="mt-3"
            color="error"
            variant="soft"
            icon="i-lucide-circle-alert"
            :description="runtime.error"
          />

          <UAlert
            v-if="updateStatus || updateError"
            class="mt-3"
            :color="updateStatusColor"
            variant="soft"
            icon="i-lucide-activity"
            :title="updateStatusTitle"
            :description="updateStatusDescription"
          />
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
