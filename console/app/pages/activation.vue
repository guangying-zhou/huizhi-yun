<script setup lang="ts">
definePageMeta({
  layout: false
})

interface ActivationStatus {
  mode: 'pending' | 'active' | 'failed'
  activated: boolean
  envValid: boolean
  licenseValid: boolean
  bundleReady: boolean
  tenantCode: string | null
  deploymentCode: string | null
  bundleVersion: string | null
  bundleHash: string | null
  lastCheckedAt: string | null
  lastActivatedAt: string | null
  lastError: string | null
}

interface ApiEnvelope<T> {
  code: number
  message?: string
  data: T
}

const route = useRoute()
const toast = useToast()
const pending = ref(false)
const status = ref<ActivationStatus | null>(null)

const redirectTarget = computed(() => {
  const raw = route.query.redirect
  return typeof raw === 'string' && raw.trim() ? raw.trim() : '/'
})

const statusColor = computed<'success' | 'warning' | 'error'>(() => {
  if (status.value?.activated) return 'success'
  if (status.value?.mode === 'failed') return 'error'
  return 'warning'
})

async function loadStatus() {
  const response = await $fetch<ApiEnvelope<ActivationStatus>>('/api/activation/status', {
    cache: 'no-store'
  })
  status.value = response.data

  if (response.data.activated) {
    await navigateTo(redirectTarget.value, { replace: true })
  }
}

async function retry() {
  pending.value = true
  try {
    const response = await $fetch<ApiEnvelope<ActivationStatus>>('/api/activation/retry', {
      method: 'POST',
      cache: 'no-store'
    })
    status.value = response.data

    if (response.data.activated) {
      toast.add({ title: '激活成功', description: '已拉取并验签首版策略包', color: 'success' })
      await navigateTo(redirectTarget.value, { replace: true })
      return
    }

    toast.add({
      title: '仍在待激活',
      description: response.data.lastError || response.message || '未能拉取策略包',
      color: 'warning'
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    toast.add({ title: '重试失败', description: message, color: 'error' })
  } finally {
    pending.value = false
  }
}

let timer: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  await loadStatus().catch(() => {
    status.value = {
      mode: 'failed',
      activated: false,
      envValid: false,
      licenseValid: false,
      bundleReady: false,
      tenantCode: null,
      deploymentCode: null,
      bundleVersion: null,
      bundleHash: null,
      lastCheckedAt: new Date().toISOString(),
      lastActivatedAt: null,
      lastError: '无法读取激活状态'
    }
  })

  timer = setInterval(() => {
    if (!status.value?.activated && !pending.value) {
      retry()
    }
  }, 30000)
})

onBeforeUnmount(() => {
  if (timer) {
    clearInterval(timer)
  }
})
</script>

<template>
  <UApp>
    <div class="activation-shell">
      <UCard class="activation-card">
        <template #header>
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="text-xs font-semibold uppercase tracking-[0.25em] text-muted">
                Console Activation
              </p>
              <h1 class="mt-2 text-2xl font-semibold text-highlighted">
                企业控制台待激活
              </h1>
              <p class="mt-2 text-sm text-muted">
                当前实例正在等待 platform 策略包。license 校验失败会阻止服务启动；策略包拉取失败时进入本页并持续重试。
              </p>
            </div>
            <UBadge
              :color="statusColor"
              variant="soft"
            >
              {{ status?.activated ? 'active' : status?.mode || 'pending' }}
            </UBadge>
          </div>
        </template>

        <div class="space-y-4">
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="rounded-lg border border-default bg-muted/30 p-3">
              <p class="text-xs text-muted">
                Tenant
              </p>
              <p class="mt-1 font-mono text-sm">
                {{ status?.tenantCode || '—' }}
              </p>
            </div>
            <div class="rounded-lg border border-default bg-muted/30 p-3">
              <p class="text-xs text-muted">
                Deployment
              </p>
              <p class="mt-1 font-mono text-sm">
                {{ status?.deploymentCode || '—' }}
              </p>
            </div>
            <div class="rounded-lg border border-default bg-muted/30 p-3">
              <p class="text-xs text-muted">
                Bundle
              </p>
              <p class="mt-1 font-mono text-sm">
                {{ status?.bundleVersion || '未缓存' }}
              </p>
            </div>
            <div class="rounded-lg border border-default bg-muted/30 p-3">
              <p class="text-xs text-muted">
                Last Check
              </p>
              <p class="mt-1 font-mono text-sm">
                {{ status?.lastCheckedAt || '—' }}
              </p>
            </div>
          </div>

          <UAlert
            v-if="status?.lastError"
            color="error"
            variant="soft"
            icon="i-lucide-triangle-alert"
            title="最近一次错误"
            :description="status.lastError"
          />

          <UAlert
            v-else
            color="info"
            variant="soft"
            icon="i-lucide-info"
            title="自动重试已开启"
            description="页面每 30 秒自动重试一次，也可以手动点击重试。"
          />

          <div class="flex flex-wrap gap-2">
            <UButton
              icon="i-lucide-refresh-cw"
              :loading="pending"
              @click="retry"
            >
              重试拉取
            </UButton>
            <UButton
              color="neutral"
              variant="soft"
              icon="i-lucide-log-in"
              to="/login"
            >
              去登录页
            </UButton>
          </div>
        </div>
      </UCard>
    </div>
  </UApp>
</template>

<style scoped>
.activation-shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 2rem;
  background:
    radial-gradient(circle at 20% 20%, rgba(20, 184, 166, 0.18), transparent 34rem),
    radial-gradient(circle at 80% 10%, rgba(245, 158, 11, 0.16), transparent 26rem),
    linear-gradient(135deg, #f8fafc 0%, #eef2f7 100%);
}

.activation-card {
  width: min(100%, 48rem);
  box-shadow: 0 24px 80px rgba(15, 23, 42, 0.14);
}
</style>
