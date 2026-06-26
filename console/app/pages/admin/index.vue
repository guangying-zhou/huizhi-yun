<script setup lang="ts">
import { dashboardPanelUi } from '~/utils/dashboardPanel'

usePageTitle('控制台')

type ApiEnvelope<T> = {
  code: number
  message?: string
  data?: T
}

type ActivationStatus = {
  activated: boolean
  bundleReady: boolean
  bundleVersion: string | null
  bundleHash: string | null
  lastCheckedAt: string | null
  lastHeartbeatAt: string | null
  lastError: string | null
}

type BundleRefreshState = {
  checked: boolean
  pending: boolean
  refreshRequired: boolean
  refreshed: boolean
  bundleVersion: string | null
  bundleHash: string | null
  latestBundleVersion: string | null
  lastCheckedAt: string | null
  error: string | null
}

const activationStatus = ref<ActivationStatus | null>(null)
const activationStatusError = ref<string | null>(null)
const bundleRefreshState = useState<BundleRefreshState>('console-admin-bundle-refresh', () => ({
  checked: false,
  pending: false,
  refreshRequired: false,
  refreshed: false,
  bundleVersion: null,
  bundleHash: null,
  latestBundleVersion: null,
  lastCheckedAt: null,
  error: null
}))

async function loadActivationStatus() {
  try {
    const response = await $fetch<ApiEnvelope<ActivationStatus>>('/api/activation/status', {
      cache: 'no-store'
    })
    activationStatus.value = response.data || null
    activationStatusError.value = response.code === 0 ? null : response.message || '读取失败'
  } catch (error) {
    activationStatusError.value = error instanceof Error ? error.message : String(error)
  }
}

onMounted(() => {
  void loadActivationStatus()
})

watch(
  () => [bundleRefreshState.value.checked, bundleRefreshState.value.bundleVersion, bundleRefreshState.value.bundleHash],
  () => {
    void loadActivationStatus()
  }
)

const currentBundleVersion = computed(() => (
  bundleRefreshState.value.bundleVersion
  || activationStatus.value?.bundleVersion
  || ''
))

const currentBundleHash = computed(() => (
  bundleRefreshState.value.bundleHash
  || activationStatus.value?.bundleHash
  || ''
))

const bundleCardValue = computed(() => {
  if (bundleRefreshState.value.pending && !currentBundleVersion.value) {
    return '检测中'
  }
  return currentBundleVersion.value || '未就绪'
})

const bundleCardTone = computed(() => {
  if (bundleRefreshState.value.error || activationStatusError.value || activationStatus.value?.lastError) {
    return 'text-error'
  }
  if (bundleRefreshState.value.pending) {
    return 'text-primary'
  }
  if (!currentBundleVersion.value) {
    return 'text-warning'
  }
  if (bundleRefreshState.value.refreshed) {
    return 'text-success'
  }
  return 'text-primary'
})

const bundleCardDescription = computed(() => {
  if (bundleRefreshState.value.error || activationStatusError.value || activationStatus.value?.lastError) {
    return bundleRefreshState.value.error || activationStatusError.value || activationStatus.value?.lastError || '检测失败'
  }
  if (bundleRefreshState.value.pending) {
    return '正在检测 Platform 最新版本'
  }
  if (bundleRefreshState.value.latestBundleVersion && bundleRefreshState.value.latestBundleVersion !== currentBundleVersion.value) {
    return `Platform 最新: ${bundleRefreshState.value.latestBundleVersion}`
  }
  if (currentBundleHash.value) {
    return `hash ${currentBundleHash.value.slice(0, 12)}`
  }
  return activationStatus.value?.bundleReady ? '已同步' : '等待激活'
})

const summaryCards = computed(() => [
  {
    label: 'Policy Bundle',
    value: bundleCardValue.value,
    description: bundleCardDescription.value,
    icon: 'i-lucide-file-check-2',
    tone: bundleCardTone.value
  },
  {
    label: 'Vault 健康',
    value: '待初始化',
    icon: 'i-lucide-key-round',
    tone: 'text-warning'
  },
  {
    label: '集成异常',
    value: '0',
    icon: 'i-lucide-plug-zap',
    tone: 'text-success'
  },
  {
    label: '待轮换凭证',
    value: '0',
    icon: 'i-lucide-refresh-cw',
    tone: 'text-success'
  }
])

const homeDashboardPanelUi = {
  ...dashboardPanelUi,
  body: `${dashboardPanelUi.body} sm:gap-3 sm:p-2 m-0`
}

const bootstrapSteps = [
  '初始化企业资料 org_profiles',
  '创建基础 vault secret',
  '绑定外部 integration 配置',
  '签发本地 service client'
]
</script>

<template>
  <UDashboardPanel id="admin-home" :ui="homeDashboardPanelUi">
    <template #body>
      <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <UCard
          v-for="item in summaryCards"
          :key="item.label"
          :ui="{ body: 'flex items-center gap-3' }"
        >
          <UIcon :name="item.icon" class="size-7 shrink-0" :class="item.tone" />
          <div class="min-w-0">
            <p class="text-xs text-muted">
              {{ item.label }}
            </p>
            <p class="break-all text-lg font-semibold">
              {{ item.value }}
            </p>
            <p v-if="item.description" class="mt-0.5 truncate text-xs text-muted">
              {{ item.description }}
            </p>
          </div>
        </UCard>
      </div>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <span class="font-semibold">初始化顺序</span>
          </div>
        </template>
        <div class="grid gap-2 md:grid-cols-4">
          <div
            v-for="(step, index) in bootstrapSteps"
            :key="step"
            class="rounded-md border border-default p-3"
          >
            <div class="mb-2 flex items-center gap-2">
              <UBadge color="neutral" variant="soft">
                {{ index + 1 }}
              </UBadge>
              <span class="text-sm font-medium">{{ step }}</span>
            </div>
            <p class="text-xs text-muted">
              按设计文档约束逐步接入，避免先创建绑定对象再发现基础配置缺失。
            </p>
          </div>
        </div>
      </UCard>
    </template>
  </UDashboardPanel>
</template>
