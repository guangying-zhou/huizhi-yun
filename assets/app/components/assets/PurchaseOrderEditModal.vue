<script setup lang="ts">
import type { ApiResponse, PurchaseOrderItem } from '~/types'

const props = defineProps<{
  open: boolean
  order: PurchaseOrderItem | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'updated': []
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
  purchase_type: '',
  purpose_type: '',
  applicant_uid: '',
  applicant_dept_code: '',
  project_code: '',
  customer_code: '',
  contract_code: '',
  environment_id: '',
  supplier_id: '',
  status: '',
  budget_amount: '',
  actual_amount: '',
  reason: ''
})

function hydrate() {
  state.purchase_type = props.order?.purchase_type || ''
  state.purpose_type = normalizePurposeType(props.order?.purpose_type || '')
  state.applicant_uid = props.order?.applicant_uid || ''
  state.applicant_dept_code = props.order?.applicant_dept_code || ''
  state.project_code = props.order?.project_code || ''
  state.customer_code = props.order?.customer_code || ''
  state.contract_code = props.order?.contract_code || ''
  state.environment_id = props.order?.environment_id ? String(props.order.environment_id) : ''
  state.supplier_id = props.order?.supplier_id ? String(props.order.supplier_id) : ''
  state.status = props.order?.status || ''
  state.budget_amount = props.order?.budget_amount !== undefined ? String(props.order.budget_amount) : ''
  state.actual_amount = props.order?.actual_amount !== undefined && props.order?.actual_amount !== null ? String(props.order.actual_amount) : ''
  state.reason = props.order?.reason || ''
}

watch(() => props.open, (open) => {
  if (open) {
    hydrate()
  }
})

watch(() => props.order, () => {
  if (props.open) {
    hydrate()
  }
})

async function handleSubmit() {
  if (!props.order?.id) {
    return
  }

  if (state.purpose_type === 'project_procurement' && !state.project_code.trim()) {
    toast.add({ title: '缺少项目编码', description: '项目采购必须填写项目编码。', color: 'warning' })
    return
  }

  submitting.value = true

  try {
    await $fetch<ApiResponse<{ id: number }>>(`/api/v1/purchase-orders/${props.order.id}`, {
      method: 'PATCH',
      body: {
        purchase_type: state.purchase_type.trim() || null,
        purpose_type: state.purpose_type.trim() || null,
        applicant_uid: state.applicant_uid.trim() || null,
        applicant_dept_code: state.applicant_dept_code.trim() || null,
        project_code: state.project_code.trim() || null,
        customer_code: state.customer_code.trim() || null,
        contract_code: state.contract_code.trim() || null,
        environment_id: state.environment_id ? Number(state.environment_id) : null,
        supplier_id: state.supplier_id ? Number(state.supplier_id) : null,
        status: state.status.trim() || null,
        budget_amount: state.budget_amount ? Number(state.budget_amount) : null,
        actual_amount: state.actual_amount ? Number(state.actual_amount) : null,
        reason: state.reason.trim() || null
      }
    })

    toast.add({
      title: '采购单已更新',
      description: '主要信息已保存。',
      color: 'success',
      icon: 'i-lucide-check'
    })

    emit('updated')
    isOpen.value = false
  } catch (error) {
    console.error('[PurchaseOrderEdit] Failed:', error)
    toast.add({
      title: '更新失败',
      description: '请检查录入内容后重试。',
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
    title="编辑采购单"
    description="维护采购申请的主要信息，审批和入库动作仍通过独立操作完成。"
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

          <UFormField label="申请人 UID">
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

          <UFormField label="状态">
            <USelect
              v-model="state.status"
              :items="purchaseStatusOptions"
              placeholder="请选择采购单状态"
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
        </div>

        <UFormField label="申请原因">
          <UTextarea
            v-model="state.reason"
            :rows="4"
            placeholder="补充采购背景、交付场景或资源用途"
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
        <UButton :loading="submitting" icon="i-lucide-save" @click="handleSubmit">
          保存
        </UButton>
      </div>
    </template>
  </UModal>
</template>
