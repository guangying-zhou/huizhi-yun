<script setup lang="ts">
import type { ApiResponse } from '~/types'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'created': [id: number]
}>()

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const { loadDictionaries, getOptions } = useAssetDictionaries()
await loadDictionaries()

const toast = useToast()
const submitting = ref(false)
const purchaseTypeOptions = computed(() => getOptions('purchase_type'))
const purposeTypeOptions = computed(() => getOptions('purchase_purpose_type'))
const purchaseStatusOptions = computed(() => getOptions('purchase_status'))

function normalizePurposeType(value: string) {
  if (value === 'internal') return 'self_use'
  if (value === 'customer_delivery') return 'project_procurement'
  return value
}

const state = reactive({
  purchase_type: 'physical',
  purpose_type: 'self_use',
  applicant_uid: '',
  applicant_dept_code: 'RND',
  project_code: '',
  customer_code: '',
  contract_code: '',
  environment_id: '',
  supplier_id: '',
  budget_amount: '',
  actual_amount: '',
  status: 'draft',
  reason: ''
})

function resetState() {
  state.purchase_type = 'physical'
  state.purpose_type = normalizePurposeType('self_use')
  state.applicant_uid = ''
  state.applicant_dept_code = 'RND'
  state.project_code = ''
  state.customer_code = ''
  state.contract_code = ''
  state.environment_id = ''
  state.supplier_id = ''
  state.budget_amount = ''
  state.actual_amount = ''
  state.status = 'draft'
  state.reason = ''
}

watch(() => props.open, (open) => {
  if (open) {
    resetState()
  }
})

async function handleSubmit() {
  if (!state.applicant_uid.trim()) {
    toast.add({ title: '缺少申请人', description: '请先填写申请人 UID。', color: 'warning' })
    return
  }

  if (state.purpose_type === 'project_procurement' && !state.project_code.trim()) {
    toast.add({ title: '缺少项目编码', description: '项目采购必须填写项目编码。', color: 'warning' })
    return
  }

  submitting.value = true

  try {
    const response = await $fetch<ApiResponse<{ id: number }>>('/api/v1/purchase-orders', {
      method: 'POST',
      body: {
        purchase_type: state.purchase_type.trim() || 'physical',
        purpose_type: state.purpose_type.trim() || 'self_use',
        applicant_uid: state.applicant_uid.trim(),
        applicant_dept_code: state.applicant_dept_code.trim() || 'UNKNOWN',
        project_code: state.project_code.trim() || null,
        customer_code: state.customer_code.trim() || null,
        contract_code: state.contract_code.trim() || null,
        environment_id: state.environment_id ? Number(state.environment_id) : null,
        supplier_id: state.supplier_id ? Number(state.supplier_id) : null,
        budget_amount: state.budget_amount ? Number(state.budget_amount) : 0,
        actual_amount: state.actual_amount ? Number(state.actual_amount) : null,
        status: state.status.trim() || 'draft',
        reason: state.reason.trim() || null
      }
    })

    toast.add({
      title: '采购单已创建',
      description: `已生成采购单记录 #${response.data.id}`,
      color: 'success',
      icon: 'i-lucide-check'
    })

    emit('created', response.data.id)
    isOpen.value = false
  } catch (error) {
    console.error('[PurchaseOrderCreate] Failed:', error)
    toast.add({
      title: '创建失败',
      description: '请检查申请人、供应商或金额字段。',
      color: 'error',
      icon: 'i-lucide-circle-alert'
    })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    title="新增采购单"
    description="录入采购申请的主要信息，后续再补充审批和明细。"
    :ui="{ content: 'sm:max-w-3xl' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <div class="grid gap-4 md:grid-cols-2">
          <UFormField label="采购类型">
            <USelect
              v-model="state.purchase_type"
              :items="purchaseTypeOptions"
              placeholder="请选择采购类型"
              class="w-full"
            />
          </UFormField>

          <UFormField label="采购目的">
            <USelect
              v-model="state.purpose_type"
              :items="purposeTypeOptions"
              placeholder="请选择采购目的"
              class="w-full"
            />
          </UFormField>

          <UFormField label="申请人 UID" required>
            <UInput
              v-model="state.applicant_uid"
              placeholder="例如：U1002"
              class="w-full"
            />
          </UFormField>

          <UFormField label="申请部门">
            <UInput
              v-model="state.applicant_dept_code"
              placeholder="例如：RND / DELIVERY"
              class="w-full"
            />
          </UFormField>

          <UFormField label="项目编码">
            <UInput
              v-model="state.project_code"
              placeholder="例如：delivery/hljt-crm"
              class="w-full"
            />
          </UFormField>

          <UFormField label="客户编码">
            <UInput
              v-model="state.customer_code"
              placeholder="例如：CUST-HLJT"
              class="w-full"
            />
          </UFormField>

          <UFormField label="合同编码">
            <UInput
              v-model="state.contract_code"
              placeholder="例如：CONT-HLJT-2026"
              class="w-full"
            />
          </UFormField>

          <UFormField label="环境 ID">
            <UInput
              v-model="state.environment_id"
              type="number"
              placeholder="例如：1"
              class="w-full"
            />
          </UFormField>

          <UFormField label="供应商 ID">
            <UInput
              v-model="state.supplier_id"
              type="number"
              placeholder="例如：1"
              class="w-full"
            />
          </UFormField>

          <UFormField label="预算金额">
            <UInput
              v-model="state.budget_amount"
              type="number"
              placeholder="例如：5000"
              class="w-full"
            />
          </UFormField>

          <UFormField label="实际金额">
            <UInput
              v-model="state.actual_amount"
              type="number"
              placeholder="可选"
              class="w-full"
            />
          </UFormField>

          <UFormField label="状态">
            <USelect
              v-model="state.status"
              :items="purchaseStatusOptions"
              placeholder="请选择采购单状态"
              class="w-full"
            />
          </UFormField>
        </div>

        <UFormField label="申请原因">
          <UTextarea
            v-model="state.reason"
            :rows="4"
            placeholder="说明采购背景、资源用途或交付场景"
            class="w-full"
          />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-3">
        <UButton color="neutral" variant="outline" @click="isOpen = false">
          取消
        </UButton>
        <UButton :loading="submitting" icon="i-lucide-plus" @click="handleSubmit">
          创建
        </UButton>
      </div>
    </template>
  </UModal>
</template>
