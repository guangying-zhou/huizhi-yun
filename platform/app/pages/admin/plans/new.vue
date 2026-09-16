<script setup lang="ts">
definePageMeta({
  layout: 'platform'
})

usePageTitle('新建订阅计划')

interface ApiEnvelope<T> {
  success: true
  data: T
}

interface ApplicationItem {
  id: number
  appCode: string
  appName: string
  serviceRole: string
  status: string
}

interface ApplicationListResponse {
  items: ApplicationItem[]
  total: number
}

interface CapabilityItem {
  id: number
  capabilityCode: string
  capabilityName: string
  capabilityType: string
  description: string | null
}

interface CapabilityListResponse {
  items: CapabilityItem[]
}

interface SelectedApp {
  appCode: string
  appName: string
  roleInPlan: 'core' | 'business'
  pinReleaseId: number | null
  sortOrder: number
}

interface SelectedCapability {
  capabilityCode: string
  capabilityName: string
  capabilityValue: string
}

const router = useRouter()
const toast = useToast()

const form = reactive({
  planCode: '',
  planName: '',
  planTier: 'starter' as 'starter' | 'standard' | 'advanced' | 'enterprise',
  priceModel: 'fixed' as 'fixed' | 'metered' | 'custom',
  basePrice: '' as string,
  currency: 'CNY',
  billingCycle: 'monthly' as string,
  description: '',
  status: 'active' as 'active' | 'suspended' | 'disabled' | 'draft'
})

const tierItems = [
  { label: '基础 Starter', value: 'starter' },
  { label: '标准 Standard', value: 'standard' },
  { label: '高级 Advanced', value: 'advanced' },
  { label: '企业 Enterprise（全站独立部署）', value: 'enterprise' }
]
const priceModelItems = [
  { label: '固定价（fixed）', value: 'fixed' },
  { label: '按量计费（metered）', value: 'metered' },
  { label: '面议（custom）', value: 'custom' }
]
const billingCycleItems = [
  { label: '按月', value: 'monthly' },
  { label: '按年', value: 'yearly' },
  { label: '一次性', value: 'one_time' }
]
const statusItems = [
  { label: 'active', value: 'active' },
  { label: 'draft', value: 'draft' },
  { label: 'suspended', value: 'suspended' }
]

const selectedApps = ref<SelectedApp[]>([])
const selectedCaps = ref<SelectedCapability[]>([])
const submitting = ref(false)

const { data: appData, refresh: refreshApps } = usePlatformData<ApiEnvelope<ApplicationListResponse>>(
  '/api/platform/ops/applications',
  { query: { pageSize: 100 } }
)

const { data: capData, refresh: refreshCaps } = usePlatformData<ApiEnvelope<CapabilityListResponse>>(
  '/api/platform/ops/capabilities'
)

await Promise.all([refreshApps(), refreshCaps()])

const allApps = computed<ApplicationItem[]>(() => appData.value?.data.items || [])
const allCaps = computed<CapabilityItem[]>(() => capData.value?.data.items || [])

const availableApps = computed<Array<{ label: string, value: string }>>(() =>
  allApps.value
    .filter(a => !selectedApps.value.some(s => s.appCode === a.appCode))
    .map(a => ({ label: `${a.appName} (${a.appCode})`, value: a.appCode }))
)

const availableCaps = computed<Array<{ label: string, value: string }>>(() =>
  allCaps.value
    .filter(c => !selectedCaps.value.some(s => s.capabilityCode === c.capabilityCode))
    .map(c => ({ label: `${c.capabilityName} (${c.capabilityCode})`, value: c.capabilityCode }))
)

const newAppCode = ref('')
const newCapCode = ref('')

function addApp() {
  if (!newAppCode.value) return
  const found = allApps.value.find(a => a.appCode === newAppCode.value)
  if (!found) return
  const isCore = ['console', 'account', 'workflow'].includes(found.appCode)
    || found.serviceRole === 'directory_runtime'
    || found.serviceRole === 'workflow_runtime'
    || found.serviceRole === 'supporting_service'
  selectedApps.value.push({
    appCode: found.appCode,
    appName: found.appName,
    roleInPlan: isCore ? 'core' : 'business',
    pinReleaseId: null,
    sortOrder: selectedApps.value.length
  })
  newAppCode.value = ''
}

function removeApp(index: number) {
  selectedApps.value.splice(index, 1)
}

function addCap() {
  if (!newCapCode.value) return
  const found = allCaps.value.find(c => c.capabilityCode === newCapCode.value)
  if (!found) return
  selectedCaps.value.push({
    capabilityCode: found.capabilityCode,
    capabilityName: found.capabilityName,
    capabilityValue: ''
  })
  newCapCode.value = ''
}

function removeCap(index: number) {
  selectedCaps.value.splice(index, 1)
}

async function submit() {
  if (!form.planCode || !form.planName) {
    toast.add({ title: '请填写计划 code 与名称', color: 'warning' })
    return
  }

  const basePrice = form.basePrice === '' ? null : Number(form.basePrice)
  if (basePrice !== null && !Number.isFinite(basePrice)) {
    toast.add({ title: '基础价必须是数字', color: 'warning' })
    return
  }

  submitting.value = true
  try {
    const payload = {
      planCode: form.planCode.trim(),
      planName: form.planName.trim(),
      planTier: form.planTier,
      priceModel: form.priceModel,
      basePrice,
      currency: form.currency || null,
      billingCycle: form.billingCycle || null,
      description: form.description || null,
      status: form.status,
      apps: selectedApps.value.map(a => ({
        appCode: a.appCode,
        roleInPlan: a.roleInPlan,
        pinReleaseId: a.pinReleaseId,
        sortOrder: a.sortOrder
      })),
      capabilities: selectedCaps.value.map(c => ({
        capabilityCode: c.capabilityCode,
        capabilityValue: c.capabilityValue.trim() || null
      }))
    }

    await $fetch('/api/platform/ops/plans', {
      method: 'POST',
      body: payload
    })

    toast.add({ title: '已创建订阅计划', description: form.planCode, color: 'success' })
    router.push(`/admin/plans/${encodeURIComponent(form.planCode)}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : '创建失败'
    const detail = (err as { data?: { message?: string } }).data?.message
    toast.add({ title: '创建失败', description: detail || message, color: 'error' })
  } finally {
    submitting.value = false
  }
}

const crumbs = [
  { label: '工作台', to: '/admin' },
  { label: '订阅计划', to: '/admin/plans' },
  { label: '新建' }
]
</script>

<template>
  <div>
    <UBreadcrumb
      :items="crumbs"
      class="mb-4"
    />

    <div class="page-h">
      <div>
        <h1>新建订阅计划</h1>
        <p>定义计划档位、计费模式、包含的应用与能力开关。创建后可在详情页继续编辑。</p>
      </div>
      <div class="page-h-actions">
        <UButton
          color="neutral"
          variant="ghost"
          to="/admin/plans"
        >
          取消
        </UButton>
        <UButton
          color="primary"
          variant="solid"
          icon="i-lucide-check"
          :loading="submitting"
          @click="submit"
        >
          创建
        </UButton>
      </div>
    </div>

    <div class="grid gap-4 lg:grid-cols-3">
      <UCard class="lg:col-span-1">
        <template #header>
          <div class="text-sm font-medium text-highlighted">
            基础信息
          </div>
        </template>
        <div class="flex flex-col gap-3">
          <UFormField
            label="计划 Code"
            required
          >
            <UInput
              v-model="form.planCode"
              placeholder="例如：starter / pro_v2"
              size="sm"
            />
          </UFormField>
          <UFormField
            label="计划名称"
            required
          >
            <UInput
              v-model="form.planName"
              placeholder="例如：Starter 套餐"
              size="sm"
            />
          </UFormField>
          <UFormField label="档位">
            <USelect
              v-model="form.planTier"
              :items="tierItems"
              size="sm"
            />
          </UFormField>
          <UFormField label="说明">
            <UTextarea
              v-model="form.description"
              placeholder="一两句话描述这个计划面向的客户与核心价值"
              :rows="3"
            />
          </UFormField>
          <UFormField label="状态">
            <USelect
              v-model="form.status"
              :items="statusItems"
              size="sm"
            />
          </UFormField>
        </div>
      </UCard>

      <UCard class="lg:col-span-1">
        <template #header>
          <div class="text-sm font-medium text-highlighted">
            计费
          </div>
        </template>
        <div class="flex flex-col gap-3">
          <UFormField label="计费模式">
            <USelect
              v-model="form.priceModel"
              :items="priceModelItems"
              size="sm"
            />
          </UFormField>
          <UFormField label="基础价">
            <UInput
              v-model="form.basePrice"
              type="number"
              placeholder="留空表示面议"
              size="sm"
            />
          </UFormField>
          <UFormField label="币种">
            <UInput
              v-model="form.currency"
              placeholder="CNY"
              size="sm"
            />
          </UFormField>
          <UFormField label="结算周期">
            <USelect
              v-model="form.billingCycle"
              :items="billingCycleItems"
              size="sm"
            />
          </UFormField>
        </div>
      </UCard>

      <UCard class="lg:col-span-1">
        <template #header>
          <div class="text-sm font-medium text-highlighted">
            说明
          </div>
        </template>
        <div class="text-sm text-muted leading-relaxed">
          <p class="mb-2">
            <b class="text-highlighted">基础模块</b>（console / account / workflow）每个计划必须包含。
          </p>
          <p class="mb-2">
            <b class="text-highlighted">业务应用</b>按计划开通：Starter（codocs/aims）、Pro（+ assets/altoc）、Advanced（+ insights）。
          </p>
          <p>
            <b class="text-highlighted">能力开关</b>用于在 license 中签入（如 ai_gateway、advanced_audit），客户侧据此切换 UI 与 API。
          </p>
        </div>
      </UCard>

      <UCard class="lg:col-span-3">
        <template #header>
          <div class="flex items-center justify-between">
            <div class="text-sm font-medium text-highlighted">
              应用清单
              <span class="text-muted text-xs ml-2">{{ selectedApps.length }} 个</span>
            </div>
            <div class="flex items-center gap-2">
              <USelect
                v-model="newAppCode"
                :items="availableApps"
                placeholder="选择应用…"
                size="sm"
                class="w-64"
              />
              <UButton
                color="primary"
                variant="soft"
                size="sm"
                icon="i-lucide-plus"
                :disabled="!newAppCode"
                @click="addApp"
              >
                添加
              </UButton>
            </div>
          </div>
        </template>

        <div
          v-if="selectedApps.length === 0"
          class="text-muted text-sm py-6 text-center"
        >
          尚未添加应用，至少需要包含 console / account / workflow 三个基础模块。
        </div>

        <div
          v-else
          class="flex flex-col gap-2"
        >
          <div
            v-for="(app, index) in selectedApps"
            :key="app.appCode"
            class="flex items-center gap-3 rounded-md border border-default bg-elevated/40 px-3 py-2"
          >
            <UIcon
              name="i-lucide-app-window"
              class="size-4 text-muted"
            />
            <div class="min-w-0 flex-1">
              <div class="font-medium text-highlighted text-sm">
                {{ app.appName }}
              </div>
              <div class="mono text-dimmed text-xs">
                {{ app.appCode }}
              </div>
            </div>
            <USelect
              v-model="app.roleInPlan"
              :items="[
                { label: '基础模块', value: 'core' },
                { label: '业务应用', value: 'business' }
              ]"
              size="sm"
              class="w-28"
            />
            <UInput
              v-model.number="app.sortOrder"
              type="number"
              size="sm"
              class="w-20"
              placeholder="排序"
            />
            <UButton
              color="error"
              variant="ghost"
              icon="i-lucide-x"
              size="sm"
              square
              @click="removeApp(index)"
            />
          </div>
        </div>
      </UCard>

      <UCard class="lg:col-span-3">
        <template #header>
          <div class="flex items-center justify-between">
            <div class="text-sm font-medium text-highlighted">
              能力开关
              <span class="text-muted text-xs ml-2">{{ selectedCaps.length }} 个</span>
            </div>
            <div class="flex items-center gap-2">
              <USelect
                v-model="newCapCode"
                :items="availableCaps"
                placeholder="选择能力…"
                size="sm"
                class="w-64"
              />
              <UButton
                color="primary"
                variant="soft"
                size="sm"
                icon="i-lucide-plus"
                :disabled="!newCapCode"
                @click="addCap"
              >
                添加
              </UButton>
            </div>
          </div>
        </template>

        <div
          v-if="selectedCaps.length === 0"
          class="text-muted text-sm py-6 text-center"
        >
          尚未添加能力开关。能力将随 license 下发到客户侧。
        </div>

        <div
          v-else
          class="flex flex-col gap-2"
        >
          <div
            v-for="(cap, index) in selectedCaps"
            :key="cap.capabilityCode"
            class="flex items-center gap-3 rounded-md border border-default bg-elevated/40 px-3 py-2"
          >
            <UIcon
              name="i-lucide-toggle-right"
              class="size-4 text-muted"
            />
            <div class="min-w-0 flex-1">
              <div class="font-medium text-highlighted text-sm">
                {{ cap.capabilityName }}
              </div>
              <div class="mono text-dimmed text-xs">
                {{ cap.capabilityCode }}
              </div>
            </div>
            <UInput
              v-model="cap.capabilityValue"
              size="sm"
              class="w-48"
              placeholder="可选取值（如配额数量）"
            />
            <UButton
              color="error"
              variant="ghost"
              icon="i-lucide-x"
              size="sm"
              square
              @click="removeCap(index)"
            />
          </div>
        </div>
      </UCard>
    </div>
  </div>
</template>
