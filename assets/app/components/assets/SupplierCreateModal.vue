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
const supplierTypeOptions = computed(() => getOptions('supplier_type'))
const supplierStatusOptions = computed(() => getOptions('supplier_status'))

const state = reactive({
  supplier_name: '',
  supplier_type: 'service',
  credit_code: '',
  contact_name: '',
  contact_phone: '',
  contact_email: '',
  invoice_info: '',
  status: 'active',
  notes: ''
})

function resetState() {
  state.supplier_name = ''
  state.supplier_type = 'service'
  state.credit_code = ''
  state.contact_name = ''
  state.contact_phone = ''
  state.contact_email = ''
  state.invoice_info = ''
  state.status = 'active'
  state.notes = ''
}

watch(() => props.open, (open) => {
  if (open) {
    resetState()
  }
})

async function handleSubmit() {
  if (!state.supplier_name.trim()) {
    toast.add({ title: '缺少供应商名称', description: '请先填写供应商名称。', color: 'warning' })
    return
  }

  submitting.value = true

  try {
    const response = await $fetch<ApiResponse<{ id: number }>>('/api/v1/suppliers', {
      method: 'POST',
      body: {
        supplier_name: state.supplier_name.trim(),
        supplier_type: state.supplier_type.trim() || 'service',
        credit_code: state.credit_code.trim() || null,
        contact_name: state.contact_name.trim() || null,
        contact_phone: state.contact_phone.trim() || null,
        contact_email: state.contact_email.trim() || null,
        invoice_info: state.invoice_info.trim() || null,
        status: state.status.trim() || 'active',
        notes: state.notes.trim() || null
      }
    })

    toast.add({
      title: '供应商已创建',
      description: `已生成供应商记录 #${response.data.id}`,
      color: 'success',
      icon: 'i-lucide-check'
    })

    emit('created', response.data.id)
    isOpen.value = false
  } catch (error) {
    console.error('[SupplierCreate] Failed:', error)
    toast.add({
      title: '创建失败',
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
    title="新增供应商"
    description="录入采购供应商的主要信息，供采购单统一引用。"
    :ui="{ content: 'sm:max-w-3xl' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <UFormField label="供应商名称" required>
          <UInput
            v-model="state.supplier_name"
            placeholder="例如：阿里云智能集团"
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
            placeholder="补充结算、发票和付款说明"
            class="w-full"
          />
        </UFormField>

        <UFormField label="备注">
          <UTextarea
            v-model="state.notes"
            :rows="3"
            placeholder="补充合作范围、资源类型或风险说明"
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
