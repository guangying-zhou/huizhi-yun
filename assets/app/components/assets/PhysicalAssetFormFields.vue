<script setup lang="ts">
import type { Department } from '~/types/account'
import UserTreeSelector from '../../../../foundation/app/components/UserTreeSelector.vue'

type FormOption = {
  label?: string
  value?: string | number | boolean
  description?: string
  enabled?: boolean
  sortOrder?: number
}

type PhysicalAssetFormState = {
  asset_name: string
  asset_subtype: string
  physical_item_type: string
  asset_purpose: string
  dept_code: string
  purchased_at: string
  status: string
  brand: string
  model: string
  serial_number: string
  config_detail: string
  notes: string
  project_code: string
  customer_code: string
  contract_code: string
  owner_uid: string
  user_uid: string
  location: string
}

const props = withDefaults(defineProps<{
  state: PhysicalAssetFormState
  subtypeOptions: FormOption[]
  physicalItemTypeOptions: FormOption[]
  purposeOptions: FormOption[]
  statusOptions: FormOption[]
  namePlaceholder?: string
  notesPlaceholder?: string
}>(), {
  namePlaceholder: '资产名称',
  notesPlaceholder: '补充资产来源、用途或说明'
})

const emit = defineEmits<{
  'patch-state': [patch: Partial<PhysicalAssetFormState>]
}>()

function fieldModel(key: keyof PhysicalAssetFormState) {
  return computed({
    get: () => props.state[key],
    set: value => emit('patch-state', { [key]: value })
  })
}

const { flat: departmentFlat, loading: departmentsLoading } = useAccountDepartments()

const departmentOptions = computed(() => departmentFlat.value
  .filter((dept: Department) => dept.orgType !== 'committee')
  .map((dept: Department) => ({
    label: dept.name,
    value: dept.deptCode
  })))

const scopedDeptCode = computed(() => {
  if (!props.state.dept_code) return undefined
  return departmentFlat.value.some((dept: Department) => dept.deptCode === props.state.dept_code)
    ? props.state.dept_code
    : undefined
})

const ownerSelection = computed({
  get: () => props.state.owner_uid ? [props.state.owner_uid] : [],
  set: (value: string[]) => {
    emit('patch-state', { owner_uid: value[0] || '' })
  }
})

const userSelection = computed({
  get: () => props.state.user_uid ? [props.state.user_uid] : [],
  set: (value: string[]) => {
    emit('patch-state', { user_uid: value[0] || '' })
  }
})

const assetName = fieldModel('asset_name')
const assetSubtype = fieldModel('asset_subtype')
const physicalItemType = fieldModel('physical_item_type')
const assetPurpose = fieldModel('asset_purpose')
const deptCode = fieldModel('dept_code')
const purchasedAt = fieldModel('purchased_at')
const status = fieldModel('status')
const brand = fieldModel('brand')
const model = fieldModel('model')
const serialNumber = fieldModel('serial_number')
const configDetail = fieldModel('config_detail')
const notes = fieldModel('notes')
const projectCode = fieldModel('project_code')
const customerCode = fieldModel('customer_code')
const contractCode = fieldModel('contract_code')
const location = fieldModel('location')
</script>

<template>
  <div class="space-y-4">
    <UFormField label="资产名称" required>
      <UInput
        v-model="assetName"
        :placeholder="namePlaceholder"
        class="w-full"
      />
    </UFormField>

    <div class="grid gap-4 md:grid-cols-2">
      <UFormField label="资产子类">
        <USelect
          v-model="assetSubtype"
          :items="subtypeOptions"
          placeholder="请选择资产子类"
          class="w-full"
        />
      </UFormField>

      <UFormField label="实物细类">
        <USelect
          v-model="physicalItemType"
          :items="physicalItemTypeOptions"
          placeholder="请选择实物细类"
          class="w-full"
        />
      </UFormField>

      <UFormField label="采购目的">
        <USelect
          v-model="assetPurpose"
          :items="purposeOptions"
          placeholder="请选择采购目的"
          class="w-full"
        />
      </UFormField>

      <UFormField label="归属部门">
        <USelect
          v-model="deptCode"
          :items="departmentOptions"
          :loading="departmentsLoading"
          placeholder="请选择归属部门"
          class="w-full"
        />
      </UFormField>

      <UFormField label="采购日期">
        <UInput v-model="purchasedAt" type="date" class="w-full" />
      </UFormField>

      <UFormField label="状态">
        <USelect
          v-model="status"
          :items="statusOptions"
          placeholder="请选择资产状态"
          class="w-full"
        />
      </UFormField>
    </div>

    <USeparator />

    <div class="grid gap-4 md:grid-cols-2">
      <UFormField label="品牌">
        <UInput
          v-model="brand"
          placeholder="例如：Lenovo"
          class="w-full"
        />
      </UFormField>

      <UFormField label="型号">
        <UInput
          v-model="model"
          placeholder="例如：ThinkPad X1"
          class="w-full"
        />
      </UFormField>

      <UFormField label="序列号">
        <UInput
          v-model="serialNumber"
          placeholder="例如：SN-LT-001"
          class="w-full"
        />
      </UFormField>

      <UFormField class="md:col-span-2" label="详细配置">
        <UTextarea
          v-model="configDetail"
          :rows="3"
          placeholder="例如：i7 / 32GB / 1TB SSD / 14英寸 / 含扩展坞"
          class="w-full"
        />
      </UFormField>
    </div>

    <UFormField label="备注">
      <UTextarea
        v-model="notes"
        :rows="4"
        :placeholder="notesPlaceholder"
        class="w-full"
      />
    </UFormField>

    <USeparator />

    <div class="grid gap-4 md:grid-cols-2">
      <UFormField label="项目编码">
        <UInput
          v-model="projectCode"
          placeholder="例如：delivery/hljt-crm"
          class="w-full"
        />
      </UFormField>

      <UFormField label="客户编码">
        <UInput
          v-model="customerCode"
          placeholder="例如：CUST-HLJT"
          class="w-full"
        />
      </UFormField>

      <UFormField label="合同编码">
        <UInput
          v-model="contractCode"
          placeholder="例如：CONT-HLJT-2026"
          class="w-full"
        />
      </UFormField>

      <UFormField label="负责人">
        <UserTreeSelector
          v-model="ownerSelection"
          selection-mode="single"
          hide-committees
          :scope-dept-code="scopedDeptCode"
          width-class="w-full"
          placeholder="请选择负责人"
        />
      </UFormField>

      <UFormField label="使用人">
        <UserTreeSelector
          v-model="userSelection"
          selection-mode="single"
          hide-committees
          :scope-dept-code="scopedDeptCode"
          width-class="w-full"
          placeholder="请选择使用人"
        />
      </UFormField>

      <UFormField label="位置">
        <UInput
          v-model="location"
          placeholder="例如：深圳研发中心 7F"
          class="w-full"
        />
      </UFormField>
    </div>
  </div>
</template>
