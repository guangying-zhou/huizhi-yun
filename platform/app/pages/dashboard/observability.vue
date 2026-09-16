<script setup lang="ts">
definePageMeta({
  layout: 'console'
})

usePageTitle('访问观测')

interface ApiEnvelope<T> {
  success: true
  data: T
}

interface SummaryOverviewItem {
  appCode: string
  eventType: string
  count: number
  errorCount: number
  slowCount: number
  avgValue: number
  maxValue: number
}

interface SummaryBucket {
  bucketStart: string
  appCode: string
  eventType: string
  route: string
  metricName: string
  count: number
  errorCount: number
  slowCount: number
  avgValue: number
  maxValue: number
}

interface SummaryResponse {
  tenantCode: string
  appCode: string | null
  windowHours: number
  overview: SummaryOverviewItem[]
  buckets: SummaryBucket[]
  counters: Array<{
    day: string
    tenant_code: string
    app_code: string
    accepted_count: number
    dropped_count: number
    updated_at: string
  }>
}

interface SettingItem {
  tenantCode: string
  appCode: string
  enabled: boolean
  sampleRate: number
  errorSampleRate: number
  slowThresholdMs: number
  createdAt: string | null
  updatedAt: string | null
}

interface SettingsResponse {
  tenantCode: string
  items: SettingItem[]
}

const { currentTenantCode } = useTenantContext()
const toast = useToast()

const pending = ref(false)
const errorMessage = ref('')
const notConfigured = ref(false)
const summary = ref<SummaryResponse | null>(null)
const settings = ref<SettingItem[]>([])
const savingApp = ref('')
const windowHours = ref(24)

const activeTenantCode = computed(() => currentTenantCode.value)
const totalEvents = computed(() => summary.value?.overview.reduce((sum, item) => sum + item.count, 0) || 0)
const totalErrors = computed(() => summary.value?.overview.reduce((sum, item) => sum + item.errorCount, 0) || 0)
const totalSlow = computed(() => summary.value?.overview.reduce((sum, item) => sum + item.slowCount, 0) || 0)
const errorRate = computed(() => totalEvents.value ? totalErrors.value / totalEvents.value : 0)

const appRows = computed(() => {
  const appMap = new Map<string, {
    appCode: string
    count: number
    errorCount: number
    slowCount: number
    avgApiMs: number
    maxApiMs: number
  }>()

  for (const item of summary.value?.overview || []) {
    const row = appMap.get(item.appCode) || {
      appCode: item.appCode,
      count: 0,
      errorCount: 0,
      slowCount: 0,
      avgApiMs: 0,
      maxApiMs: 0
    }

    row.count += item.count
    row.errorCount += item.errorCount
    row.slowCount += item.slowCount

    if (item.eventType === 'api_timing') {
      row.avgApiMs = item.avgValue
      row.maxApiMs = item.maxValue
    }

    appMap.set(item.appCode, row)
  }

  return Array.from(appMap.values()).sort((a, b) => b.count - a.count)
})

const recentBuckets = computed(() => (summary.value?.buckets || []).slice(0, 12))
const cards = computed(() => [
  {
    label: '事件数',
    value: formatInteger(totalEvents.value),
    detail: `最近 ${windowHours.value} 小时`
  },
  {
    label: '错误率',
    value: `${(errorRate.value * 100).toFixed(2)}%`,
    detail: `${formatInteger(totalErrors.value)} 个错误事件`
  },
  {
    label: '慢请求',
    value: formatInteger(totalSlow.value),
    detail: '按应用阈值判断'
  },
  {
    label: '启用应用',
    value: formatInteger(settings.value.filter(item => item.enabled).length),
    detail: `${settings.value.length} 个应用有配置`
  }
])

watch(activeTenantCode, () => {
  loadObservability()
}, { immediate: true })

async function loadObservability() {
  if (!activeTenantCode.value) {
    return
  }

  pending.value = true
  errorMessage.value = ''
  notConfigured.value = false

  try {
    const [summaryResponse, settingsResponse] = await Promise.all([
      platformFetchJson<ApiEnvelope<SummaryResponse>>('/api/platform/tenant-admin/observability/summary', {
        query: {
          tenantCode: activeTenantCode.value,
          hours: windowHours.value
        }
      }),
      platformFetchJson<ApiEnvelope<SettingsResponse>>('/api/platform/tenant-admin/observability/settings', {
        query: {
          tenantCode: activeTenantCode.value
        }
      })
    ])

    summary.value = summaryResponse.data
    settings.value = settingsResponse.data.items.map(item => ({ ...item }))
  } catch (error) {
    const message = extractErrorMessage(error, '访问观测数据加载失败')
    const status = (error as { statusCode?: number }).statusCode
    if (status === 503 || /not configured/i.test(message)) {
      notConfigured.value = true
      summary.value = null
      settings.value = []
    } else {
      errorMessage.value = message
    }
  } finally {
    pending.value = false
  }
}

async function saveSetting(item: SettingItem) {
  savingApp.value = item.appCode
  try {
    const response = await platformFetchJson<ApiEnvelope<SettingItem>>('/api/platform/tenant-admin/observability/settings', {
      method: 'PUT',
      body: {
        tenantCode: activeTenantCode.value,
        appCode: item.appCode,
        enabled: item.enabled,
        sampleRate: Number(item.sampleRate),
        errorSampleRate: Number(item.errorSampleRate),
        slowThresholdMs: Number(item.slowThresholdMs)
      }
    })

    Object.assign(item, response.data)
    toast.add({
      title: '观测配置已保存',
      color: 'success'
    })
  } catch (error) {
    toast.add({
      title: extractErrorMessage(error, '观测配置保存失败'),
      color: 'error'
    })
  } finally {
    savingApp.value = ''
  }
}

function extractErrorMessage(error: unknown, fallback: string) {
  const record = error as {
    data?: {
      message?: string
      statusMessage?: string
    }
    message?: string
  } | null

  return record?.data?.message || record?.data?.statusMessage || record?.message || fallback
}

function formatInteger(value: number) {
  return Math.round(value).toLocaleString('zh-CN')
}

function formatMs(value: number) {
  if (!value) return '—'
  return `${Math.round(value).toLocaleString('zh-CN')} ms`
}

function formatDateTime(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}
</script>

<template>
  <UDashboardPanel
    id="tenant-observability"
    :ui="{ body: 'console-page' }"
  >
    <template #body>
      <section class="console-hero">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div class="min-w-0">
            <h1 class="text-xl font-semibold text-highlighted">
              访问观测
            </h1>
            <p class="mt-1 text-sm text-muted">
              统一查看各应用的前端性能、接口错误和慢请求摘要，并维护租户级采样策略。
            </p>
          </div>

          <div class="flex items-center gap-2">
            <USelect
              v-model="windowHours"
              :items="[
                { label: '最近 1 小时', value: 1 },
                { label: '最近 6 小时', value: 6 },
                { label: '最近 24 小时', value: 24 },
                { label: '最近 7 天', value: 168 }
              ]"
              class="w-36"
              @update:model-value="loadObservability"
            />
            <UButton
              icon="i-lucide-refresh-cw"
              color="primary"
              variant="soft"
              :loading="pending"
              @click="loadObservability"
            >
              刷新
            </UButton>
          </div>
        </div>

        <div
          v-if="!activeTenantCode"
          class="mt-4 rounded-lg border border-dashed border-default px-4 py-6 text-sm text-muted"
        >
          请先选择企业后查看访问观测数据。
        </div>

        <UAlert
          v-else-if="notConfigured"
          class="mt-4"
          color="info"
          variant="soft"
          icon="i-lucide-info"
          title="访问观测服务尚未接入"
          description="接入观测服务后，可在此查看各应用的访问量、错误率与慢请求摘要；当前环境尚未配置观测服务地址。"
        />

        <div
          v-else-if="errorMessage"
          class="mt-4 rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error"
        >
          {{ errorMessage }}
        </div>

        <div
          v-else
          class="mt-4 space-y-4"
        >
          <div class="grid gap-3 sm:grid-cols-4">
            <div
              v-for="card in cards"
              :key="card.label"
              class="rounded-lg border border-default bg-muted px-4 py-3"
            >
              <p class="text-xs uppercase tracking-[0.2em] text-muted">
                {{ card.label }}
              </p>
              <p class="mt-1 text-xl font-semibold text-highlighted">
                {{ card.value }}
              </p>
              <p class="text-sm text-muted">
                {{ card.detail }}
              </p>
            </div>
          </div>

          <UCard :ui="{ body: 'p-0 sm:p-0' }">
            <template #header>
              <div>
                <p class="font-semibold text-highlighted">
                  应用摘要
                </p>
                <p class="text-sm text-muted">
                  按小时聚合统计，原始明细另行留存。
                </p>
              </div>
            </template>

            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-default text-sm">
                <thead class="bg-muted text-left text-xs uppercase tracking-[0.16em] text-muted">
                  <tr>
                    <th class="px-4 py-3 font-medium">
                      应用
                    </th>
                    <th class="px-4 py-3 font-medium">
                      事件
                    </th>
                    <th class="px-4 py-3 font-medium">
                      错误
                    </th>
                    <th class="px-4 py-3 font-medium">
                      慢请求
                    </th>
                    <th class="px-4 py-3 font-medium">
                      API 平均
                    </th>
                    <th class="px-4 py-3 font-medium">
                      API 峰值
                    </th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-default">
                  <tr
                    v-for="row in appRows"
                    :key="row.appCode"
                  >
                    <td class="px-4 py-3 font-medium text-highlighted">
                      {{ row.appCode }}
                    </td>
                    <td class="px-4 py-3">
                      {{ formatInteger(row.count) }}
                    </td>
                    <td class="px-4 py-3">
                      {{ formatInteger(row.errorCount) }}
                    </td>
                    <td class="px-4 py-3">
                      {{ formatInteger(row.slowCount) }}
                    </td>
                    <td class="px-4 py-3">
                      {{ formatMs(row.avgApiMs) }}
                    </td>
                    <td class="px-4 py-3">
                      {{ formatMs(row.maxApiMs) }}
                    </td>
                  </tr>
                  <tr v-if="appRows.length === 0">
                    <td
                      colspan="6"
                      class="px-4 py-8 text-center text-muted"
                    >
                      暂无观测摘要，应用产生访问后会自动上报。
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </UCard>

          <UCard :ui="{ body: 'p-0 sm:p-0' }">
            <template #header>
              <div>
                <p class="font-semibold text-highlighted">
                  采样配置
                </p>
                <p class="text-sm text-muted">
                  普通性能事件按采样率上报，错误事件独立采样。
                </p>
              </div>
            </template>

            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-default text-sm">
                <thead class="bg-muted text-left text-xs uppercase tracking-[0.16em] text-muted">
                  <tr>
                    <th class="px-4 py-3 font-medium">
                      应用
                    </th>
                    <th class="px-4 py-3 font-medium">
                      启用
                    </th>
                    <th class="px-4 py-3 font-medium">
                      性能采样
                    </th>
                    <th class="px-4 py-3 font-medium">
                      错误采样
                    </th>
                    <th class="px-4 py-3 font-medium">
                      慢请求阈值
                    </th>
                    <th class="px-4 py-3 font-medium">
                      更新时间
                    </th>
                    <th class="px-4 py-3" />
                  </tr>
                </thead>
                <tbody class="divide-y divide-default">
                  <tr
                    v-for="item in settings"
                    :key="item.appCode"
                  >
                    <td class="px-4 py-3 font-medium text-highlighted">
                      {{ item.appCode }}
                    </td>
                    <td class="px-4 py-3">
                      <USwitch v-model="item.enabled" />
                    </td>
                    <td class="px-4 py-3">
                      <UInput
                        v-model="item.sampleRate"
                        type="number"
                        step="0.01"
                        min="0"
                        max="1"
                        class="w-24"
                      />
                    </td>
                    <td class="px-4 py-3">
                      <UInput
                        v-model="item.errorSampleRate"
                        type="number"
                        step="0.01"
                        min="0"
                        max="1"
                        class="w-24"
                      />
                    </td>
                    <td class="px-4 py-3">
                      <UInput
                        v-model="item.slowThresholdMs"
                        type="number"
                        step="100"
                        min="100"
                        max="60000"
                        class="w-28"
                      />
                    </td>
                    <td class="px-4 py-3 text-muted">
                      {{ formatDateTime(item.updatedAt) }}
                    </td>
                    <td class="px-4 py-3 text-right">
                      <UButton
                        size="sm"
                        color="primary"
                        variant="soft"
                        :loading="savingApp === item.appCode"
                        @click="saveSetting(item)"
                      >
                        保存
                      </UButton>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </UCard>

          <UCard :ui="{ body: 'p-0 sm:p-0' }">
            <template #header>
              <div>
                <p class="font-semibold text-highlighted">
                  最近摘要
                </p>
                <p class="text-sm text-muted">
                  用于排查近期错误和慢请求集中在哪个应用、路由和指标上。
                </p>
              </div>
            </template>

            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-default text-sm">
                <thead class="bg-muted text-left text-xs uppercase tracking-[0.16em] text-muted">
                  <tr>
                    <th class="px-4 py-3 font-medium">
                      时间
                    </th>
                    <th class="px-4 py-3 font-medium">
                      应用
                    </th>
                    <th class="px-4 py-3 font-medium">
                      类型
                    </th>
                    <th class="px-4 py-3 font-medium">
                      路由
                    </th>
                    <th class="px-4 py-3 font-medium">
                      指标
                    </th>
                    <th class="px-4 py-3 font-medium">
                      次数
                    </th>
                    <th class="px-4 py-3 font-medium">
                      均值
                    </th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-default">
                  <tr
                    v-for="bucket in recentBuckets"
                    :key="`${bucket.bucketStart}-${bucket.appCode}-${bucket.eventType}-${bucket.route}-${bucket.metricName}`"
                  >
                    <td class="px-4 py-3 whitespace-nowrap text-muted">
                      {{ formatDateTime(bucket.bucketStart) }}
                    </td>
                    <td class="px-4 py-3">
                      {{ bucket.appCode }}
                    </td>
                    <td class="px-4 py-3">
                      {{ bucket.eventType }}
                    </td>
                    <td class="px-4 py-3 max-w-xs truncate">
                      {{ bucket.route }}
                    </td>
                    <td class="px-4 py-3">
                      {{ bucket.metricName }}
                    </td>
                    <td class="px-4 py-3">
                      {{ formatInteger(bucket.count) }}
                    </td>
                    <td class="px-4 py-3">
                      {{ formatMs(bucket.avgValue) }}
                    </td>
                  </tr>
                  <tr v-if="recentBuckets.length === 0">
                    <td
                      colspan="7"
                      class="px-4 py-8 text-center text-muted"
                    >
                      暂无摘要数据。
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </UCard>
        </div>
      </section>
    </template>
  </UDashboardPanel>
</template>
