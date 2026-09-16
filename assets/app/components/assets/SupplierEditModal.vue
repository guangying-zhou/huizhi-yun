<script setup lang="ts">
import type { ApiResponse, SupplierItem } from '~/types'

const props = defineProps<{
  open: boolean
  supplier: SupplierItem | null
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
const supplierTypeOptions = computed(() => getOptions('supplier_type'))
const supplierStatusOptions = computed(() => getOptions('supplier_status'))

const state = reactive({
  supplier_name: '',
  supplier_type: '',
  credit_code: '',
  contact_name: '',
  contact_phone: '',
  contact_email: '',
  invoice_info: '',
  status: '',
  notes: ''
})

function hydrate() {
  state.supplier_name = props.supplier?.supplier_name || ''
  state.supplier_type = props.supplier?.supplier_type || ''
  state.credit_code = props.supplier?.credit_code || ''
  state.contact_name = props.supplier?.contact_name || ''
  state.contact_phone = props.supplier?.contact_phone || ''
  state.contact_email = props.supplier?.contact_email || ''
  state.invoice_info = props.supplier?.invoice_info || ''
  state.status = props.supplier?.status || ''
  state.notes = props.supplier?.notes || ''
}

watch(() => props.open, (open) => {
  if (open) {
    hydrate()
  }
})

watch(() => props.supplier, () => {
  if (props.open) {
    hydrate()
  }
})

async function handleSubmit() {
  if (!props.supplier?.id) {
    return
  }

  if (!state.supplier_name.trim()) {
    toast.add({ title: '缺少供应商名称', description: '请先填写供应商名称。', color: 'warning' })
    return
  }

  submitting.value = true

  try {
    await $fetch<ApiResponse<{ id: number }>>(`/api/v1/suppliers/${props.supplier.id}`, {
      method: 'PATCH',
      body: {
        supplier_name: state.supplier_name.trim(),
        supplier_type: state.supplier_type.trim() || null,
        credit_code: state.credit_code.trim() || null,
        contact_name: state.contact_name.trim() || null,
        contact_phone: state.contact_phone.trim() || null,
        contact_email: state.contact_email.trim() || null,
        invoice_info: state.invoice_info.trim() || null,
        status: state.status.trim() || null,
        notes: state.notes.trim() || null
      }
    })

    toast.add({
      title: '供应商已更新',
      description: '主要信息已保存。',
      color: 'success',
      icon: 'i-lucide-check'
    })

    emit('updated')
    isOpen.value = false
  } catch (error) {
    console.error('[SupplierEdit] Failed:', error)
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
    title="编辑供应商"
    description="维护供应商的主要联系与结算信息。"
    :ui="{ content: 'sm:max-w-3xl' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <UFormField label="供应商名称" required>
          <UInput
            v-model="state.supplier_name"
            placeholder="供应商名称"
            class="w-full"
          />
        </UFormField>

        <div class="grid gap-4 md:grid-cols-2">
          <UFormField label="供应商类型">
            <USelect
              v-model="state.supplier_type"
              :items="supplierTypeOptions"
              placeholder="请选择供应商类型"
              class="w-full"
            />
          </UFormField>

          <UFormField label="状态">
            <USelect
              v-model="state.status"
              :items="supplierStatusOptions"
              placeholder="请选择供应商状态"
              class="w-full"
            />
          </UFormField>

          <UFormField label="统一社会信用代码">
            <UInput
              v-model="state.credit_code"
              placeholder="可选"
              class="w-full"
            />
          </UFormField>

          <UFormField label="联系人">
            <UInput
              v-model="state.contact_name"
              placeholder="例如：李工"
              class="w-full"
            />
          </UFormField>

          <UFormField label="联系电话">
            <UInput
              v-model="state.contact_phone"
              placeholder="例如：13800000001"
              class="w-full"
            />
          </UFormField>

          <UFormField label="联系邮箱">
            <UInput
              v-model="state.contact_email"
              placeholder="例如：sales@example.com"
              class="w-full"
            />
          </UFormField>
        </div>

        <UFormField label="开票信息">
          <UTextarea
            v-model="state.invoice_info"
            :rows="3"
            placeholder="补充发票和付款要求"
            class="w-full"
          />
        </UFormField>

        <UFormField label="备注">
          <UTextarea
            v-model="state.notes"
            :rows="3"
            placeholder="补充合作范围、风险或限制"
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
