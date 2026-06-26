<script setup lang="ts">
import type { Customer, OpportunityStage } from '~/types/altoc'
import { FORECAST_CATEGORY_OPTIONS, OPPORTUNITY_PIPELINE_OPTIONS, OPPORTUNITY_SOURCE_OPTIONS } from '~/types/altoc'
import { unwrapApiData, unwrapApiList, unwrapApiPage } from '~/utils/apiResponse'
import { isOpportunityOpenNormalStage, opportunityStagePipelineCode } from '~/utils/opportunityStages'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const { user: authUser } = useAuth()

const loading = ref(false)
const initialCustomerId = route.query.customer_id ? Number(route.query.customer_id) : null

type CustomerOption = Pick<Customer, 'id' | 'code' | 'name' | 'short_name'>
interface OpportunityCreateResponse {
  id: number | string
  code?: string
}

// 加载配置
const { data: stages } = useFetch('/api/v1/config/opportunity-stages', {
  transform: (res: unknown) => unwrapApiList<OpportunityStage>(res).filter(isOpportunityOpenNormalStage)
})

// 搜索客户
const customerInput = ref('')
const customerFocused = ref(false)
const customerLoading = ref(false)
const customerMatches = ref<CustomerOption[]>([])
let customerSearchTimer: ReturnType<typeof setTimeout> | null = null
let customerSearchSeq = 0

const form = reactive({
  name: '',
  customer_id: initialCustomerId as number | null,
  pipeline_code: 'default',
  stage_id: null as number | null, // 加载后自动设为第一个阶段
  source_type: '',
  source_detail: '',
  forecast_category: 'pipeline',
  amount_tax_inclusive: null as number | null,
  expected_sign_date: '',
  expected_payment_date: '',
  owner_user_id: authUser.value || '',
  next_action: '',
  next_action_due_at: ''
})

const forecastOptions = FORECAST_CATEGORY_OPTIONS
  .filter(o => o.value !== 'commit')
  .map(o => ({ label: o.label, value: o.value }))
const pipelineOptions = OPPORTUNITY_PIPELINE_OPTIONS
const sourceOptions = OPPORTUNITY_SOURCE_OPTIONS.map(o => ({ label: o.label, value: o.value }))
const availableStages = computed(() => (stages.value || [])
  .filter(stage => opportunityStagePipelineCode(stage) === form.pipeline_code))

// 阶段加载或管线切换后默认选中该模板的第一个开放阶段
watch([stages, () => form.pipeline_code], () => {
  const firstStage = availableStages.value[0]
  const currentStageStillAvailable = availableStages.value.some(stage => Number(stage.id) === Number(form.stage_id))
  if (!firstStage) {
    form.stage_id = null
  } else if (!currentStageStillAvailable) {
    form.stage_id = firstStage.id
  }
}, { immediate: true })

function getErrorMessage(err: unknown, fallback: string) {
  const error = err as { data?: { statusMessage?: string, message?: string }, message?: string }
  return error?.data?.statusMessage || error?.data?.message || error?.message || fallback
}

async function fetchCustomerPage(keyword: string, page: number) {
  const response = await $fetch<unknown>('/api/v1/customers', {
    query: {
      keyword: keyword || undefined,
      page,
      pageSize: 100
    }
  })
  return unwrapApiPage<CustomerOption>(response)
}

async function loadCustomerMatches(keyword = customerInput.value) {
  const seq = ++customerSearchSeq
  customerLoading.value = true
  try {
    const all: CustomerOption[] = []
    let page = 1
    let total = 0

    do {
      const result = await fetchCustomerPage(keyword.trim(), page)
      all.push(...result.items)
      total = result.total
      page += 1
      if (!result.items.length) break
    } while (all.length < total)

    if (seq === customerSearchSeq) {
      customerMatches.value = all
    }
  } catch {
    if (seq === customerSearchSeq) {
      customerMatches.value = []
    }
  } finally {
    if (seq === customerSearchSeq) {
      customerLoading.value = false
    }
  }
}

function scheduleCustomerSearch() {
  if (customerSearchTimer) {
    clearTimeout(customerSearchTimer)
  }
  customerSearchTimer = setTimeout(() => {
    loadCustomerMatches()
  }, 200)
}

function applyCustomerSelection(customer: CustomerOption) {
  customerInput.value = customer.name
  form.customer_id = customer.id
  customerFocused.value = false
}

function clearCustomerSelection() {
  form.customer_id = null
}

function onCustomerInput() {
  clearCustomerSelection()
}

function onCustomerFocus() {
  customerFocused.value = true
}

function onCustomerBlur() {
  window.setTimeout(() => {
    customerFocused.value = false
  }, 200)
}

function selectCustomer(customer: CustomerOption) {
  applyCustomerSelection(customer)
}

function clearCustomerInput() {
  customerInput.value = ''
  clearCustomerSelection()
  customerFocused.value = false
  loadCustomerMatches('')
}

async function loadCustomer(customerId: number) {
  try {
    const res = await $fetch<unknown>(`/api/v1/customers/${customerId}`)
    const customer = unwrapApiData<Customer>(res) as Customer | undefined
    if (!customer) return
    applyCustomerSelection({
      id: customer.id,
      code: customer.code,
      name: customer.name,
      short_name: customer.short_name
    })
  } catch {
    // 初始客户加载失败时保持空输入，提交校验会拦截。
  }
}

watch(customerInput, scheduleCustomerSearch)

onMounted(() => {
  if (initialCustomerId) {
    loadCustomer(initialCustomerId)
  } else {
    loadCustomerMatches('')
  }
})

async function handleSubmit() {
  if (!form.name.trim()) {
    toast.add({ title: '请输入商机名称', color: 'error' })
    return
  }
  if (!form.customer_id) {
    toast.add({ title: '请选择客户', color: 'error' })
    return
  }
  if (!form.owner_user_id?.trim()) {
    toast.add({ title: '请选择商机提供者', color: 'error' })
    return
  }
  if (!form.next_action.trim() || !form.next_action_due_at) {
    toast.add({ title: '请填写下一步行动和截止日期', color: 'error' })
    return
  }

  loading.value = true
  try {
    const response = await $fetch<unknown>('/api/v1/opportunities', {
      method: 'POST',
      body: {
        ...form,
        source_type: form.source_type || null,
        source_detail: form.source_detail || null,
        expected_sign_date: form.expected_sign_date || null,
        expected_payment_date: form.expected_payment_date || null,
        next_action_due_at: form.next_action_due_at || null
      }
    })
    const created = unwrapApiData<OpportunityCreateResponse>(response) as OpportunityCreateResponse
    toast.add({ title: '商机创建成功', color: 'success' })
    router.push(`/opportunities/${created.id}`)
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, '创建失败'), color: 'error' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="opportunity-new">
    <template #body>
      <Teleport to="#altoc-layout-header-title">
        <UButton
          icon="i-lucide-arrow-left"
          variant="ghost"
          color="neutral"
          @click="router.back()"
        />
        <h1 class="truncate text-base font-semibold">
          新建商机
        </h1>
      </Teleport>
      <Teleport to="#altoc-layout-header-actions">
        <UButton
          label="保存"
          icon="i-lucide-check"
          color="primary"
          :loading="loading"
          @click="handleSubmit"
        />
      </Teleport>

      <div class="p-6 space-y-6">
        <UCard :ui="{ root: 'overflow-visible', body: 'overflow-visible' }">
          <template #header>
            <span class="font-semibold">商机信息</span>
          </template>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <UFormField label="商机名称" required>
              <UInput v-model="form.name" placeholder="如：XX项目信息化建设" class="w-full" />
            </UFormField>
            <UFormField label="所属客户" required>
              <div class="relative">
                <UInput
                  v-model="customerInput"
                  placeholder="输入客户名称筛选选择"
                  class="w-full"
                  @focus="onCustomerFocus"
                  @blur="onCustomerBlur"
                  @input="onCustomerInput"
                >
                  <template v-if="customerInput" #trailing>
                    <UButton
                      icon="i-lucide-circle-x"
                      color="neutral"
                      variant="ghost"
                      square
                      size="xs"
                      @mousedown.prevent
                      @click="clearCustomerInput"
                    />
                  </template>
                </UInput>
                <div
                  v-if="customerFocused && !form.customer_id"
                  class="absolute z-50 w-full mt-1 bg-default border border-default rounded-md shadow-lg max-h-56 overflow-y-auto"
                >
                  <div v-if="customerLoading" class="px-3 py-2 text-sm text-muted">
                    正在搜索...
                  </div>
                  <template v-else-if="customerMatches.length">
                    <div
                      v-for="customer in customerMatches"
                      :key="customer.id"
                      class="px-3 py-2 text-sm cursor-pointer hover:bg-elevated"
                      @mousedown.prevent="selectCustomer(customer)"
                    >
                      <div class="font-medium">
                        {{ customer.name }}
                      </div>
                      <div class="text-xs text-muted">
                        {{ customer.code || customer.short_name || '-' }}
                      </div>
                    </div>
                  </template>
                  <div v-else class="px-3 py-2 text-sm text-muted">
                    未找到匹配客户
                  </div>
                </div>
              </div>
            </UFormField>
            <UFormField label="销售管线">
              <USelect
                v-model="form.pipeline_code"
                :items="pipelineOptions"
                class="w-full"
              />
            </UFormField>
            <UFormField label="商机来源">
              <USelect
                v-model="form.source_type"
                :items="sourceOptions"
                placeholder="选择来源"
                class="w-full"
              />
            </UFormField>
            <UFormField label="来源详细说明">
              <UTextarea
                v-model="form.source_detail"
                placeholder="如：拜访对象、推荐人、推广渠道、来电线索等"
                :rows="2"
                class="w-full"
              />
            </UFormField>
            <UFormField>
              <template #label>
                <span class="flex items-center gap-1">预测分类
                  <UTooltip>
                    <template #content>
                      <div class="text-xs space-y-1 p-1">
                        <div>管线：有可能成交的机会</div>
                        <div>最佳预期：如果顺利，3个月到半年内能签单</div>
                        <div>承诺：客户已口头确认，3个月内定能下单</div>
                      </div>
                    </template>
                    <UIcon name="i-lucide-info" class="text-muted w-3.5 h-3.5" />
                  </UTooltip>
                </span>
              </template>
              <USelect v-model="form.forecast_category" :items="forecastOptions" class="w-full" />
            </UFormField>
            <UFormField label="预计金额(含税/元)">
              <UInput
                v-model.number="form.amount_tax_inclusive"
                type="number"
                placeholder="0"
                class="w-full"
              />
            </UFormField>
            <UFormField label="预计签约日期">
              <UInput v-model="form.expected_sign_date" type="date" class="w-full" />
            </UFormField>
            <UFormField label="商机提供者" required>
              <UserPicker v-model="form.owner_user_id" />
            </UFormField>
            <UFormField label="下一步行动" required>
              <UInput
                v-model="form.next_action"
                placeholder="如：约客户需求确认会"
                class="w-full"
              />
            </UFormField>
            <UFormField label="下一步截止日期" required>
              <UInput v-model="form.next_action_due_at" type="date" class="w-full" />
            </UFormField>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
