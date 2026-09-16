<script setup lang="ts">
definePageMeta({
  layout: 'platform',
  middleware: 'admin-onboarding-deprecated'
})

usePageTitle('开通详情（已废弃）')

interface ApiEnvelope<T> {
  success: true
  data: T
}

interface OnboardingStep {
  stepCode: string
  stepName: string
  stepStatus: string
  blockerReason: string | null
  updatedAt: string
}

interface OnboardingResult {
  tenant: {
    tenantCode: string
    tenantName: string
    onboardingStage: string
  }
  deployment: {
    deploymentCode: string
    deploymentName: string
    deploymentMode: string
  } | null
  license: {
    licenseCode: string
    status: string
    signedToken: string | null
  } | null
  runtimeToken: string | null
  bundle: {
    bundleVersion: string
    bundleHash: string
  } | null
  subjectReady: boolean
  consoleEnv: string | null
  licenseArtifact: string | null
  steps: OnboardingStep[]
}

interface FetchLikeError extends Error {
  data?: {
    message?: string
    statusMessage?: string
  }
}

const route = useRoute()
const toast = useToast()
const tenantCode = computed(() => String(route.params.tenantCode || ''))

const rotateRuntimeToken = ref(false)
const forceBundle = ref(false)
const platformBaseUrl = ref('')
const runtimeTokenExpiresAt = ref('')
const actionPending = ref(false)
const actionResult = ref<OnboardingResult | null>(null)

const tab = ref<'overview' | 'steps' | 'env' | 'license'>('overview')

const data = ref<ApiEnvelope<OnboardingResult> | null>(null)
const pending = ref(false)
const error = ref<unknown>(null)

async function refresh() {
  pending.value = true
  error.value = null
  try {
    data.value = await $fetch('/api/platform/ops/onboarding/status', {
      query: { tenantCode: tenantCode.value }
    }) as ApiEnvelope<OnboardingResult>
  } catch (caught) {
    error.value = caught
  } finally {
    pending.value = false
  }
}

watch(tenantCode, () => {
  void refresh()
})

await refresh()

const status = computed(() => actionResult.value || data.value?.data || null)

const tabItems = computed(() => [
  { value: 'overview', label: '概览' },
  { value: 'steps', label: '步骤', badge: status.value?.steps.length || 0 },
  { value: 'env', label: 'console.env', disabled: !status.value?.consoleEnv },
  { value: 'license', label: 'License Token', disabled: !status.value?.licenseArtifact }
])

const fetchErrorMessage = computed(() => {
  const err = error.value as FetchLikeError | null
  return err?.data?.message || err?.data?.statusMessage || err?.message || '开通状态加载失败'
})

const crumbs = computed(() => [
  { label: '工作台', to: '/admin' },
  { label: '开通向导', to: '/admin/onboarding' },
  { label: status.value?.tenant.tenantName || tenantCode.value }
])

function errorMessage(errorValue: unknown) {
  const fetchError = errorValue as FetchLikeError
  return fetchError.data?.message || fetchError.data?.statusMessage || fetchError.message || '操作失败'
}

function stepColor(stepStatus: string): 'success' | 'warning' | 'error' | 'neutral' | 'info' {
  if (stepStatus === 'completed') return 'success'
  if (stepStatus === 'blocked') return 'warning'
  if (stepStatus === 'failed') return 'error'
  if (stepStatus === 'running') return 'info'
  return 'neutral'
}

function downloadText(filename: string, content: string | null) {
  if (!content || !import.meta.client) return
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

async function copyText(content: string | null, label: string) {
  if (!content) return
  await navigator.clipboard?.writeText(content)
  toast.add({ title: '已复制', description: label, color: 'success' })
}

async function callFinalize() {
  actionPending.value = true
  try {
    const response = await platformFetchJson<ApiEnvelope<OnboardingResult>>('/api/platform/ops/onboarding/finalize', {
      method: 'POST',
      body: {
        tenantCode: tenantCode.value,
        platformBaseUrl: platformBaseUrl.value.trim() || undefined,
        rotateRuntimeToken: rotateRuntimeToken.value,
        runtimeTokenExpiresAt: runtimeTokenExpiresAt.value || undefined,
        forceBundle: forceBundle.value
      }
    })

    actionResult.value = response.data
    await refresh()
    toast.add({
      title: response.data.bundle ? 'Finalize 完成' : '仍等待 subject_sync',
      color: response.data.bundle ? 'success' : 'warning'
    })
  } catch (err) {
    toast.add({ title: errorMessage(err), color: 'error' })
  } finally {
    actionPending.value = false
  }
}

async function rotateTokenOnly() {
  actionPending.value = true
  try {
    const response = await platformFetchJson<ApiEnvelope<OnboardingResult>>('/api/platform/ops/onboarding/step', {
      method: 'POST',
      body: {
        tenantCode: tenantCode.value,
        stepCode: 'runtime_token',
        platformBaseUrl: platformBaseUrl.value.trim() || undefined,
        runtimeTokenExpiresAt: runtimeTokenExpiresAt.value || undefined
      }
    })

    actionResult.value = response.data
    await refresh()
    toast.add({ title: 'Runtime token 已重新签发', color: 'success' })
  } catch (err) {
    toast.add({ title: errorMessage(err), color: 'error' })
  } finally {
    actionPending.value = false
  }
}
</script>

<template>
  <div>
    <UBreadcrumb
      :items="crumbs"
      class="mb-4"
    />

    <UAlert
      v-if="error"
      color="error"
      variant="soft"
      :title="fetchErrorMessage"
      class="mb-4"
    >
      <template #actions>
        <UButton
          color="error"
          variant="ghost"
          size="sm"
          icon="i-lucide-refresh-cw"
          @click="() => refresh()"
        >
          重试
        </UButton>
      </template>
    </UAlert>

    <template v-if="status">
      <!-- 实体头：紧凑 -->
      <div class="entity-header">
        <div class="flex min-w-0 items-start gap-3">
          <div class="grid size-11 shrink-0 place-items-center rounded-lg bg-muted text-muted">
            <UIcon
              name="i-lucide-building-2"
              class="size-5"
            />
          </div>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <h1 class="text-xl font-semibold text-highlighted">
                {{ status.tenant.tenantName }}
              </h1>
              <UBadge
                :color="status.subjectReady ? 'success' : 'warning'"
                variant="soft"
                size="sm"
              >
                <template #leading>
                  <span class="size-1.5 rounded-full bg-current" />
                </template>
                {{ status.subjectReady ? 'subject ready' : 'awaiting subject_sync' }}
              </UBadge>
              <UBadge
                :color="status.bundle ? 'success' : 'neutral'"
                variant="soft"
                size="sm"
              >
                {{ status.bundle ? `bundle ${status.bundle.bundleVersion}` : 'no bundle' }}
              </UBadge>
            </div>
            <div class="mono text-dimmed text-xs mt-0.5">
              {{ status.tenant.tenantCode }} · 阶段 {{ status.tenant.onboardingStage }}
            </div>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-arrow-left"
            to="/admin/onboarding"
          >
            返回向导
          </UButton>
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-refresh-cw"
            :loading="pending"
            @click="() => refresh()"
          >
            刷新
          </UButton>
        </div>
      </div>

      <div class="mt-6 grid gap-4 lg:grid-cols-[1fr_360px]">
        <!-- 左：Tabs 主区 -->
        <div>
          <UTabs
            v-model="tab"
            :items="tabItems"
            :content="false"
          />

          <!-- 概览 -->
          <UCard
            v-if="tab === 'overview'"
            class="mt-4"
            :ui="{ body: 'space-y-3' }"
          >
            <div class="grid gap-3 sm:grid-cols-3">
              <div class="rounded-md border border-default p-3">
                <div class="text-xs text-muted">
                  Deployment
                </div>
                <div class="mt-1 font-medium text-highlighted">
                  {{ status.deployment?.deploymentName || '—' }}
                </div>
                <div class="mono text-dimmed text-xs truncate">
                  {{ status.deployment?.deploymentCode || '—' }}
                </div>
                <div class="mt-1 text-dimmed text-xs">
                  {{ status.deployment?.deploymentMode || '—' }}
                </div>
              </div>
              <div class="rounded-md border border-default p-3">
                <div class="text-xs text-muted">
                  License
                </div>
                <div class="mt-1 font-medium text-highlighted">
                  {{ status.license?.licenseCode || '—' }}
                </div>
                <div class="mt-1">
                  <UBadge
                    v-if="status.license"
                    :color="status.license.status === 'active' ? 'success' : 'warning'"
                    variant="soft"
                    size="sm"
                  >
                    {{ status.license.status }}
                  </UBadge>
                  <span
                    v-else
                    class="text-dimmed text-xs"
                  >未签发</span>
                </div>
              </div>
              <div class="rounded-md border border-default p-3">
                <div class="text-xs text-muted">
                  Bundle
                </div>
                <div class="mt-1 font-medium text-highlighted">
                  {{ status.bundle?.bundleVersion || '未生成' }}
                </div>
                <div
                  v-if="status.bundle?.bundleHash"
                  class="mono text-dimmed text-xs truncate"
                >
                  {{ status.bundle.bundleHash.slice(0, 16) }}…
                </div>
              </div>
            </div>
          </UCard>

          <!-- 步骤 -->
          <UCard
            v-if="tab === 'steps'"
            class="mt-4"
            :ui="{ body: 'p-0 sm:p-0' }"
          >
            <ol class="divide-y divide-default">
              <li
                v-for="(step, index) in status.steps"
                :key="step.stepCode"
                class="flex flex-wrap items-center gap-3 px-4 py-3"
              >
                <span class="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-muted text-xs font-medium">{{ index + 1 }}</span>
                <div class="min-w-0 flex-1">
                  <div class="font-medium text-highlighted text-sm">
                    {{ step.stepName }}
                  </div>
                  <div class="mono text-dimmed text-xs">
                    {{ step.stepCode }} · {{ step.updatedAt }}
                  </div>
                  <p
                    v-if="step.blockerReason"
                    class="mt-1 text-xs text-warning"
                  >
                    {{ step.blockerReason }}
                  </p>
                </div>
                <UBadge
                  :color="stepColor(step.stepStatus)"
                  variant="soft"
                  size="sm"
                >
                  {{ step.stepStatus }}
                </UBadge>
              </li>
            </ol>
          </UCard>

          <!-- console.env -->
          <UCard
            v-if="tab === 'env'"
            class="mt-4"
            :ui="{ body: 'space-y-2' }"
          >
            <div class="flex items-center justify-end gap-2">
              <UButton
                size="sm"
                variant="soft"
                icon="i-lucide-copy"
                @click="copyText(status!.consoleEnv, 'console.env')"
              >
                复制
              </UButton>
              <UButton
                size="sm"
                variant="soft"
                icon="i-lucide-download"
                @click="downloadText(`${status!.tenant.tenantCode}.console.env`, status!.consoleEnv)"
              >
                下载
              </UButton>
            </div>
            <textarea
              :value="status.consoleEnv || ''"
              readonly
              class="min-h-96 w-full rounded-md border border-default bg-muted/30 p-3 font-mono text-xs leading-relaxed outline-none"
            />
          </UCard>

          <!-- License Token -->
          <UCard
            v-if="tab === 'license'"
            class="mt-4"
            :ui="{ body: 'space-y-2' }"
          >
            <div class="flex items-center justify-end gap-2">
              <UButton
                size="sm"
                variant="soft"
                icon="i-lucide-copy"
                @click="copyText(status!.licenseArtifact, 'License Token')"
              >
                复制
              </UButton>
              <UButton
                size="sm"
                variant="soft"
                icon="i-lucide-download"
                @click="downloadText(`${status!.tenant.tenantCode}.license-token.json`, status!.licenseArtifact)"
              >
                下载
              </UButton>
            </div>
            <textarea
              :value="status.licenseArtifact || ''"
              readonly
              class="min-h-72 w-full rounded-md border border-default bg-muted/30 p-3 font-mono text-xs leading-relaxed outline-none"
            />
          </UCard>
        </div>

        <!-- 右：操作面板（sticky） -->
        <div class="lg:sticky lg:top-4 self-start">
          <UCard :ui="{ body: 'space-y-4' }">
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon
                  name="i-lucide-wrench"
                  class="size-4 text-muted"
                />
                <h2 class="text-base font-semibold text-highlighted">
                  操作
                </h2>
              </div>
            </template>

            <UAlert
              color="warning"
              variant="soft"
              icon="i-lucide-triangle-alert"
              title="明文 token 仅展示一次"
              description="详情页不会恢复旧 token；需要重新下载完整 console.env，请勾选重新签发。"
            />

            <div class="space-y-3">
              <UFormField label="Platform Base URL">
                <UInput
                  v-model="platformBaseUrl"
                  placeholder="留空使用服务端默认值"
                  size="sm"
                />
              </UFormField>

              <UFormField label="Runtime Token 到期">
                <UInput
                  v-model="runtimeTokenExpiresAt"
                  type="datetime-local"
                  size="sm"
                />
              </UFormField>

              <div class="space-y-2 rounded-md border border-default bg-elevated/40 p-3">
                <label class="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    v-model="rotateRuntimeToken"
                    type="checkbox"
                    class="mt-0.5 size-4 rounded border-default"
                  >
                  <span>finalize 时重新签发 runtime token</span>
                </label>
                <label class="flex items-start gap-2 text-sm cursor-pointer">
                  <input
                    v-model="forceBundle"
                    type="checkbox"
                    class="mt-0.5 size-4 rounded border-default"
                  >
                  <span>跳过 subject gate 强制生成 bundle</span>
                </label>
              </div>
            </div>

            <div class="space-y-2">
              <UButton
                block
                color="primary"
                icon="i-lucide-check-circle"
                :loading="actionPending"
                @click="callFinalize"
              >
                Finalize / 生成 bundle
              </UButton>
              <UButton
                block
                color="warning"
                variant="soft"
                icon="i-lucide-key-round"
                :loading="actionPending"
                @click="rotateTokenOnly"
              >
                仅重新签发 runtime token
              </UButton>
            </div>
          </UCard>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.entity-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid var(--ui-border);
}
</style>
