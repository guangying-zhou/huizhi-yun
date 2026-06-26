<script setup lang="ts">
import type { Ref } from 'vue'
import type { Customer, Opportunity } from '~/types/altoc'
import { OPPORTUNITY_SOURCE_OPTIONS } from '~/types/altoc'
import { unwrapApiData, unwrapApiPage } from '~/utils/apiResponse'

const route = useRoute()
const router = useRouter()
const toast = useToast()
const id = computed(() => String(route.params.id))

type CustomerOption = Pick<Customer, 'id' | 'code' | 'name' | 'short_name'>

const loading = ref(false)
const populated = ref(false)
const customerInput = ref('')
const customerFocused = ref(false)
const customerLoading = ref(false)
const customerMatches = ref<CustomerOption[]>([])
let customerSearchTimer: ReturnType<typeof setTimeout> | null = null
let customerSearchSeq = 0

const form = reactive({
  name: '',
  customer_id: null as number | null,
  source_type: '',
  source_detail: '',
  amount_tax_inclusive: null as number | null,
  expected_sign_date: '',
  expected_payment_date: '',
  owner_user_id: '',
  owner_dept_code: '',
  pre_sales_user_id: '',
  delivery_user_id: '',
  next_action: '',
  next_action_due_at: '',
  competitor_info: '',
  remark: ''
})
const originalOwnerUserId = ref('')

const sourceOptions = OPPORTUNITY_SOURCE_OPTIONS.map(o => ({ label: o.label, value: o.value }))

const opportunityFetch = useFetch(() => `/api/v1/opportunities/${id.value}`, {
  transform: (res: unknown) => unwrapApiData<Opportunity>(res)
})
const opportunity = opportunityFetch.data as Ref<Opportunity | null | undefined>
const status = opportunityFetch.status
const refresh = opportunityFetch.refresh

watch(opportunity, (value) => {
  if (!value || populated.value) return
  form.name = value.name || ''
  form.customer_id = value.customer_id
  form.source_type = value.source_type || ''
  form.source_detail = value.source_detail || ''
  form.amount_tax_inclusive = value.amount_tax_inclusive
  form.expected_sign_date = value.expected_sign_date?.slice(0, 10) || ''
  form.expected_payment_date = value.expected_payment_date?.slice(0, 10) || ''
  form.owner_user_id = value.owner_user_id || ''
  form.owner_dept_code = value.owner_dept_code || ''
  originalOwnerUserId.value = form.owner_user_id
  form.pre_sales_user_id = value.pre_sales_user_id || ''
  form.delivery_user_id = value.delivery_user_id || ''
  form.next_action = value.next_action || ''
  form.next_action_due_at = value.next_action_due_at?.slice(0, 10) || ''
  form.competitor_info = value.competitor_info || ''
  form.remark = value.remark || ''
  customerInput.value = value.customer_name || ''
  populated.value = true
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
    void loadCustomerMatches()
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
  void loadCustomerMatches('')
}

watch(customerInput, scheduleCustomerSearch)

onMounted(() => {
  void loadCustomerMatches(customerInput.value)
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
    toast.add({ title: '请选择负责人', color: 'error' })
    return
  }
  if (form.next_action.trim() && !form.next_action_due_at) {
    toast.add({ title: '请填写下一步截止日期', color: 'error' })
    return
  }

  loading.value = true
  try {
    const ownerChanged = form.owner_user_id !== originalOwnerUserId.value
    await $fetch(`/api/v1/opportunities/${id.value}` as string, {
      method: 'PATCH',
      body: {
        name: form.name,
        customer_id: form.customer_id,
        source_type: form.source_type || null,
        source_detail: form.source_detail || null,
        amount_tax_inclusive: form.amount_tax_inclusive,
        expected_sign_date: form.expected_sign_date || null,
        expected_payment_date: form.expected_payment_date || null,
        pre_sales_user_id: form.pre_sales_user_id || null,
        delivery_user_id: form.delivery_user_id || null,
        next_action: form.next_action || null,
        next_action_due_at: form.next_action_due_at || null,
        competitor_info: form.competitor_info || null,
        remark: form.remark || null
      }
    })
    if (ownerChanged) {
      await $fetch(`/api/v1/opportunities/${id.value}/assign` as string, {
        method: 'POST',
        body: {
          owner_user_id: form.owner_user_id
        }
      })
      originalOwnerUserId.value = form.owner_user_id
    }
    toast.add({ title: '商机已保存', color: 'success' })
    await refresh()
    router.push(`/opportunities/${id.value}`)
  } catch (err: unknown) {
    toast.add({ title: getErrorMessage(err, '保存失败'), color: 'error' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UDashboardPanel id="opportunity-edit">
    <template #body>
      <Teleport to="#altoc-layout-header-title">
        <UButton
          icon="i-lucide-arrow-left"
          variant="ghost"
          color="neutral"
          @click="router.push(`/opportunities/${id}`)"
        />
        <h1 class="truncate text-base font-semibold">
          编辑商机
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

      <div v-if="status === 'pending'" class="p-6">
        <USkeleton class="h-64 w-full" />
      </div>

      <div v-else class="p-6 space-y-6">
        <UCard :ui="{ root: 'overflow-visible', body: 'overflow-visible' }">
          <template #header>
            <span class="font-semibold">商机信息</span>
          </template>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <UFormField label="商机名称" required>
              <UInput v-model="form.name" class="w-full" />
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
                  v-if="customerFocused"
                  class="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border border-default bg-default shadow-lg"
                >
                  <div v-if="customerLoading" class="px-3 py-2 text-sm text-muted">
                    加载中...
                  </div>
                  <button
                    v-for="customer in customerMatches"
                    :key="customer.id"
                    type="button"
                    class="block w-full px-3 py-2 text-left text-sm hover:bg-elevated"
                    @mousedown.prevent
                    @click="selectCustomer(customer)"
                  >
                    <div class="font-medium">
                      {{ customer.name }}
                    </div>
                    <div class="text-xs text-muted">
                      {{ customer.code }} {{ customer.short_name ? `· ${customer.short_name}` : '' }}
                    </div>
                  </button>
                  <div v-if="!customerLoading && customerMatches.length === 0" class="px-3 py-2 text-sm text-muted">
                    无匹配客户
                  </div>
                </div>
              </div>
            </UFormField>

            <UFormField label="商机来源">
              <USelect
                v-model="form.source_type"
                :items="sourceOptions"
                placeholder="选择来源"
                class="w-full"
              />
            </UFormField>
            <UFormField label="预计金额(元)">
              <UInput v-model.number="form.amount_tax_inclusive" type="number" class="w-full" />
            </UFormField>
            <UFormField label="预计签约日期">
              <UInput v-model="form.expected_sign_date" type="date" class="w-full" />
            </UFormField>
            <UFormField label="预计回款日期">
              <UInput v-model="form.expected_payment_date" type="date" class="w-full" />
            </UFormField>
            <UFormField label="负责人" required>
              <UserPicker v-model="form.owner_user_id" />
            </UFormField>
            <UFormField label="售前负责人">
              <UserPicker v-model="form.pre_sales_user_id" placeholder="选择售前" />
            </UFormField>
            <UFormField label="交付负责人">
              <UserPicker v-model="form.delivery_user_id" placeholder="选择交付" />
            </UFormField>
            <UFormField label="下一步动作">
              <UInput v-model="form.next_action" class="w-full" />
            </UFormField>
            <UFormField label="下一步截止">
              <UInput v-model="form.next_action_due_at" type="date" class="w-full" />
            </UFormField>
            <UFormField label="来源说明" class="md:col-span-2">
              <UTextarea v-model="form.source_detail" :rows="3" class="w-full" />
            </UFormField>
            <UFormField label="竞品信息" class="md:col-span-2">
              <UTextarea v-model="form.competitor_info" :rows="3" class="w-full" />
            </UFormField>
            <UFormField label="备注" class="md:col-span-2">
              <UTextarea v-model="form.remark" :rows="3" class="w-full" />
            </UFormField>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
