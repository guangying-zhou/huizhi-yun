<script setup lang="ts">
definePageMeta({
  layout: 'platform',
  middleware: 'admin-onboarding-deprecated'
})

usePageTitle('开通向导（已废弃）')

interface ApiEnvelope<T> {
  success: true
  data: T
}

interface PlanRow {
  planCode: string
  planName: string
  planTier: string
  status: string
}

interface PlanListResponse {
  items: PlanRow[]
}

interface TenantRow {
  tenantCode: string
  tenantName: string
  displayName: string | null
  primaryDomain: string | null
  status: string
  defaultDeploymentMode: string
  planCode: string | null
}

interface TenantListResponse {
  items: TenantRow[]
}

interface OnboardingStep {
  stepCode: string
  stepName: string
  stepStatus: string
  blockerReason: string | null
}

interface OnboardingResult {
  tenant: {
    tenantCode: string
    tenantName: string
    onboardingStage: string
  }
  plan: {
    planCode: string
    planName: string
  } | null
  deployment: {
    deploymentCode: string
    deploymentName: string
    deploymentMode: string
    publicUrl?: string | null
    rootAppCode?: string | null
    basePath?: string | null
    apiBase?: string | null
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

const router = useRouter()
const toast = useToast()

const { data: plansData, pending: plansPending, refresh: refreshPlans } = usePlatformData<ApiEnvelope<PlanListResponse>>(
  '/api/platform/ops/plans',
  { query: { status: 'active', page: 1, pageSize: 100 } }
)

const { data: tenantsData, pending: tenantsPending, refresh: refreshTenants } = usePlatformData<ApiEnvelope<TenantListResponse>>(
  '/api/platform/ops/tenants',
  { query: { page: 1, pageSize: 500 } }
)

await Promise.all([refreshPlans(), refreshTenants()])

const planItems = computed<Array<{ label: string, value: string }>>(() => ((plansData.value?.data.items || []) as PlanRow[]).map(plan => ({
  label: `${plan.planName} (${plan.planCode})`,
  value: plan.planCode
})))

const tenants = computed<TenantRow[]>(() => tenantsData.value?.data.items || [])
const tenantItems = computed<Array<{ label: string, value: string }>>(() => tenants.value.map(tenant => ({
  label: `${tenant.displayName || tenant.tenantName} (${tenant.tenantCode})`,
  value: tenant.tenantCode
})))

const selectedTenantCode = ref('')
const selectedTenant = computed<TenantRow | null>(() => tenants.value.find(t => t.tenantCode === selectedTenantCode.value) || null)

const form = reactive({
  tenantName: '',
  displayName: '',
  primaryDomain: '',
  planCode: '',
  deploymentMode: 'customer-hosted',
  deploymentPublicUrl: '',
  rootAppCode: 'console',
  consoleBasePath: '',
  platformBaseUrl: '',
  licenseExpiresAt: '',
  runtimeTokenExpiresAt: '',
  generateBundle: true,
  forceBundle: false
})

const deploymentModeItems = [
  { label: 'customer-hosted', value: 'customer-hosted' },
  { label: 'self-hosted-enterprise', value: 'self-hosted-enterprise' },
  { label: 'managed-control-plane', value: 'managed-control-plane' }
]

const showAdvanced = ref(false)
const pending = ref(false)
const result = ref<OnboardingResult | null>(null)
const resultTab = ref<'summary' | 'steps' | 'env' | 'license'>('summary')

const resultTabItems = computed(() => [
  { value: 'summary', label: '概览' },
  { value: 'steps', label: '步骤', badge: result.value?.steps.length || 0 },
  { value: 'env', label: 'console.env' },
  { value: 'license', label: 'License Token' }
])

watch(planItems, (items) => {
  if (!form.planCode && items.length) {
    form.planCode = items[0]!.value
  }
}, { immediate: true })

watch(selectedTenant, (tenant) => {
  if (!tenant) {
    form.tenantName = ''
    form.displayName = ''
    form.primaryDomain = ''
    form.deploymentPublicUrl = ''
    return
  }
  form.tenantName = tenant.tenantName
  form.displayName = tenant.displayName || ''
  form.primaryDomain = tenant.primaryDomain || ''
  form.deploymentPublicUrl = tenant.primaryDomain ? `https://${tenant.primaryDomain.replace(/^https?:\/\//, '').replace(/\/+$/, '')}` : ''

  if (tenant.defaultDeploymentMode && deploymentModeItems.some(item => item.value === tenant.defaultDeploymentMode)) {
    form.deploymentMode = tenant.defaultDeploymentMode
  }
  if (tenant.planCode && planItems.value.some(item => item.value === tenant.planCode)) {
    form.planCode = tenant.planCode
  }
}, { immediate: true })

function errorMessage(error: unknown) {
  const fetchError = error as FetchLikeError
  return fetchError.data?.message || fetchError.data?.statusMessage || fetchError.message || '开通失败'
}

function stepColor(status: string): 'success' | 'warning' | 'error' | 'neutral' | 'info' {
  if (status === 'completed') return 'success'
  if (status === 'blocked') return 'warning'
  if (status === 'failed') return 'error'
  if (status === 'running') return 'info'
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

async function submit() {
  if (!selectedTenant.value) {
    toast.add({ title: '请选择企业租户', color: 'error' })
    return
  }
  if (!form.planCode) {
    toast.add({ title: '请选择订阅计划', color: 'error' })
    return
  }
  if (!form.deploymentPublicUrl.trim()) {
    toast.add({ title: '请填写企业端部署 URL', color: 'error' })
    return
  }

  pending.value = true
  try {
    const response = await platformFetchJson<ApiEnvelope<OnboardingResult>>('/api/platform/ops/onboarding/start', {
      method: 'POST',
      body: {
        tenantCode: selectedTenant.value.tenantCode,
        tenantName: form.tenantName.trim(),
        displayName: form.displayName.trim() || undefined,
        primaryDomain: form.primaryDomain.trim() || undefined,
        planCode: form.planCode,
        deploymentMode: form.deploymentMode,
        deploymentPublicUrl: form.deploymentPublicUrl.trim() || undefined,
        rootAppCode: form.rootAppCode.trim() || undefined,
        consoleBasePath: form.consoleBasePath.trim() || undefined,
        platformBaseUrl: form.platformBaseUrl.trim() || undefined,
        licenseExpiresAt: form.licenseExpiresAt || undefined,
        runtimeTokenExpiresAt: form.runtimeTokenExpiresAt || undefined,
        generateBundle: form.generateBundle,
        forceBundle: form.forceBundle
      }
    })

    result.value = response.data
    resultTab.value = 'summary'
    toast.add({
      title: '开通编排已完成',
      description: response.data.bundle ? '已生成首版 bundle' : '等待 subject_sync 后再生成 bundle',
      color: response.data.bundle ? 'success' : 'warning'
    })
  } catch (error) {
    toast.add({ title: errorMessage(error), color: 'error' })
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div>
    <div class="page-h">
      <div>
        <h1>开通向导</h1>
        <p>按"租户 → 订阅 → console deployment → license → runtime token → bundle"生成首批交付材料。</p>
      </div>
      <div class="page-h-actions">
        <UButton
          color="neutral"
          variant="ghost"
          icon="i-lucide-building-2"
          to="/admin/tenants"
        >
          租户台账
        </UButton>
      </div>
    </div>

    <div class="grid gap-4 ">
      <!-- 左侧表单 -->
      <UCard :ui="{ body: 'space-y-5' }">
        <template #header>
          <div>
            <h2 class="text-base font-semibold text-highlighted">
              新企业开通
            </h2>
            <p class="mt-1 text-xs text-muted">
              明文 runtime token 仅在本次响应展示一次，重新进入详情页需主动轮换。
            </p>
          </div>
        </template>

        <form
          class="space-y-5"
          @submit.prevent="submit"
        >
          <div
            class="grid space-x-6 lg:grid-cols-[minmax(380px,420px)_1fr]"
          >
            <section class="space-y-3">
              <div class="flex items-center gap-2">
                <span class="grid size-5 place-items-center rounded-full bg-primary text-primary-contrast text-xs font-semibold">1</span>
                <h3 class="text-sm font-medium text-highlighted">
                  选择企业租户
                </h3>
              </div>
              <UFormField required>
                <USelect
                  v-model="selectedTenantCode"
                  :items="tenantItems"
                  :loading="tenantsPending"
                  placeholder="从租户列表选择企业"
                  size="sm"
                />
              </UFormField>
              <div
                v-if="selectedTenant"
                class="rounded-md border border-default bg-elevated/40 px-3 py-2"
              >
                <div class="flex items-center justify-between gap-2">
                  <div class="min-w-0">
                    <div class="text-sm font-medium text-highlighted truncate">
                      {{ selectedTenant.tenantName }}
                    </div>
                    <div class="mono text-dimmed text-xs">
                      {{ selectedTenant.tenantCode }}  {{ selectedTenant.primaryDomain }}
                    </div>
                  </div>
                  <UBadge
                    :color="selectedTenant.status === 'active' ? 'success' : 'neutral'"
                    variant="soft"
                    size="sm"
                  >
                    {{ selectedTenant.status }}
                  </UBadge>
                </div>
              </div>
            </section>

            <!-- 步骤 2：订阅 -->
            <section class="space-y-3">
              <div class="flex items-center gap-2">
                <span class="grid size-5 place-items-center rounded-full bg-primary text-primary-contrast text-xs font-semibold">2</span>
                <h3 class="text-sm font-medium text-highlighted">
                  订阅与部署
                </h3>
              </div>
              <div
                class=" grid sm:grid-cols-2 space-x-4"
              >
                <UFormField
                  label="订阅计划"
                  required
                >
                  <USelect
                    v-model="form.planCode"
                    :items="planItems"
                    :loading="plansPending"
                    placeholder="选择计划"
                    size="sm"
                  />
                </UFormField>
                <UFormField label="部署模式">
                  <USelect
                    v-model="form.deploymentMode"
                    :items="deploymentModeItems"
                    size="sm"
                  />
                </UFormField>
              </div>
              <div class="grid gap-2 sm:grid-cols-3">
                <UFormField
                  label="企业端部署 URL"
                  required
                >
                  <UInput
                    v-model="form.deploymentPublicUrl"
                    placeholder="https://hzy.wiztek.cn"
                    size="sm"
                  />
                </UFormField>
                <UFormField label="根应用 appCode">
                  <UInput
                    v-model="form.rootAppCode"
                    placeholder="console"
                    size="sm"
                  />
                </UFormField>
                <UFormField label="Console basePath">
                  <UInput
                    v-model="form.consoleBasePath"
                    placeholder="留空自动；例如 /admin/"
                    size="sm"
                  />
                </UFormField>
              </div>
            </section>
          </div>

          <USeparator />

          <!-- 步骤 3：凭证与 bundle -->
          <section class="space-y-3">
            <div class="flex items-center gap-2">
              <span class="grid size-5 place-items-center rounded-full bg-primary text-primary-contrast text-xs font-semibold">3</span>
              <h3 class="text-sm font-medium text-highlighted">
                凭证与 Bundle
              </h3>
            </div>

            <div class="space-y-2 rounded-md border border-default bg-elevated/40 p-3">
              <label class="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  v-model="form.generateBundle"
                  type="checkbox"
                  class="mt-0.5 size-4 rounded border-default"
                >
                <span>
                  开通后尝试生成首版 bundle
                  <span class="block text-xs text-muted">subject_sync 完成后才会真正生成</span>
                </span>
              </label>
            </div>

            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              size="sm"
              :icon="showAdvanced ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
              @click="showAdvanced = !showAdvanced"
            >
              高级选项
            </UButton>

            <div
              v-if="showAdvanced"
              class="space-y-3 rounded-md border border-default bg-muted/20 p-3"
            >
              <UFormField label="Platform Base URL">
                <UInput
                  v-model="form.platformBaseUrl"
                  placeholder="默认读取 PLATFORM_SERVICE_URL"
                  size="sm"
                />
              </UFormField>
              <div class="grid gap-2 sm:grid-cols-2">
                <UFormField label="License 到期">
                  <UInput
                    v-model="form.licenseExpiresAt"
                    type="datetime-local"
                    size="sm"
                  />
                </UFormField>
                <UFormField label="Runtime Token 到期">
                  <UInput
                    v-model="form.runtimeTokenExpiresAt"
                    type="datetime-local"
                    size="sm"
                  />
                </UFormField>
              </div>
              <label class="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  v-model="form.forceBundle"
                  type="checkbox"
                  class="mt-0.5 size-4 rounded border-default"
                >
                <span>
                  跳过 subject gate 强制生成 bundle
                  <span class="block text-xs text-warning">仅 demo 或已有外部兜底管理员时使用</span>
                </span>
              </label>
            </div>
          </section>

          <UButton
            type="submit"
            block
            color="primary"
            icon="i-lucide-play"
            :loading="pending"
          >
            启动开通
          </UButton>
        </form>
      </UCard>

      <!-- 右侧结果 -->
      <div>
        <UAlert
          v-if="!result"
          color="info"
          variant="soft"
          icon="i-lucide-info"
          title="开通结果会显示在这里"
          description="完成后可直接复制 console.env；Console 授权 token 已写入 env，也可在详情页单独查看。"
        />

        <UCard
          v-else
          :ui="{ body: 'space-y-4' }"
        >
          <template #header>
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="min-w-0">
                <h2 class="text-base font-semibold text-highlighted">
                  {{ result.tenant.tenantName }}
                </h2>
                <p class="mono mt-0.5 text-xs text-muted">
                  {{ result.tenant.tenantCode }} · {{ result.deployment?.deploymentCode || 'no-deployment' }}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <UBadge
                  :color="result.bundle ? 'success' : 'warning'"
                  variant="soft"
                >
                  <template #leading>
                    <span class="size-1.5 rounded-full bg-current" />
                  </template>
                  {{ result.bundle ? 'bundle ready' : 'awaiting subject_sync' }}
                </UBadge>
                <UButton
                  size="sm"
                  variant="soft"
                  icon="i-lucide-panel-right-open"
                  @click="router.push(`/admin/onboarding/${encodeURIComponent(result!.tenant.tenantCode)}`)"
                >
                  打开详情
                </UButton>
              </div>
            </div>
          </template>

          <UTabs
            v-model="resultTab"
            :items="resultTabItems"
            :content="false"
          />

          <!-- Tab: 概览 -->
          <div
            v-if="resultTab === 'summary'"
            class="grid gap-3 sm:grid-cols-4"
          >
            <div class="rounded-md border border-default p-3">
              <div class="text-xs text-muted">
                Plan
              </div>
              <div class="mt-1 font-medium text-highlighted">
                {{ result.plan?.planName || '—' }}
              </div>
              <div class="mono text-dimmed text-xs">
                {{ result.plan?.planCode || '—' }}
              </div>
            </div>
            <div class="rounded-md border border-default p-3">
              <div class="text-xs text-muted">
                License
              </div>
              <div class="mt-1 font-medium text-highlighted">
                {{ result.license?.licenseCode || '—' }}
              </div>
              <div class="text-dimmed text-xs">
                {{ result.license?.status || '—' }}
              </div>
            </div>
            <div class="rounded-md border border-default p-3">
              <div class="text-xs text-muted">
                Deployment
              </div>
              <div class="mt-1 font-medium text-highlighted truncate">
                {{ result.deployment?.publicUrl || '—' }}
              </div>
              <div class="mono text-dimmed text-xs">
                {{ result.deployment?.basePath || '—' }}
              </div>
            </div>
            <div class="rounded-md border border-default p-3">
              <div class="text-xs text-muted">
                Bundle
              </div>
              <div class="mt-1 font-medium text-highlighted">
                {{ result.bundle?.bundleVersion || '未生成' }}
              </div>
              <div
                v-if="result.bundle?.bundleHash"
                class="mono text-dimmed text-xs truncate"
              >
                {{ result.bundle.bundleHash.slice(0, 16) }}…
              </div>
            </div>
          </div>

          <!-- Tab: 步骤 -->
          <div
            v-if="resultTab === 'steps'"
            class="grid gap-2 sm:grid-cols-2"
          >
            <div
              v-for="step in result.steps"
              :key="step.stepCode"
              class="rounded-md border border-default p-3"
            >
              <div class="flex items-center justify-between gap-2">
                <span class="text-sm font-medium text-highlighted">{{ step.stepName }}</span>
                <UBadge
                  :color="stepColor(step.stepStatus)"
                  variant="soft"
                  size="sm"
                >
                  {{ step.stepStatus }}
                </UBadge>
              </div>
              <p
                v-if="step.blockerReason"
                class="mt-2 text-xs text-warning"
              >
                {{ step.blockerReason }}
              </p>
            </div>
          </div>

          <!-- Tab: console.env -->
          <div
            v-if="resultTab === 'env'"
            class="space-y-2"
          >
            <div class="flex items-center justify-end gap-2">
              <UButton
                size="sm"
                variant="soft"
                icon="i-lucide-copy"
                @click="copyText(result!.consoleEnv, 'console.env')"
              >
                复制
              </UButton>
              <UButton
                size="sm"
                variant="soft"
                icon="i-lucide-download"
                @click="downloadText(`${result!.tenant.tenantCode}.console.env`, result!.consoleEnv)"
              >
                下载
              </UButton>
            </div>
            <textarea
              :value="result.consoleEnv || ''"
              readonly
              class="min-h-80 w-full rounded-md border border-default bg-muted/30 p-3 font-mono text-xs leading-relaxed outline-none"
            />
          </div>

          <!-- Tab: License Token -->
          <div
            v-if="resultTab === 'license'"
            class="space-y-2"
          >
            <div class="flex items-center justify-end gap-2">
              <UButton
                size="sm"
                variant="soft"
                icon="i-lucide-copy"
                @click="copyText(result!.licenseArtifact, 'License Token')"
              >
                复制
              </UButton>
              <UButton
                size="sm"
                variant="soft"
                icon="i-lucide-download"
                @click="downloadText(`${result!.tenant.tenantCode}.license-token.json`, result!.licenseArtifact)"
              >
                下载
              </UButton>
            </div>
            <textarea
              :value="result.licenseArtifact || ''"
              readonly
              class="min-h-72 w-full rounded-md border border-default bg-muted/30 p-3 font-mono text-xs leading-relaxed outline-none"
            />
          </div>
        </UCard>
      </div>
    </div>
  </div>
</template>
