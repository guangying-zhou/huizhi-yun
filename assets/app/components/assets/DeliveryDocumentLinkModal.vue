<script setup lang="ts">
import type { ApiResponse, DeliveryItem } from '~/types'

const props = defineProps<{
  open: boolean
  delivery: DeliveryItem | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'created': []
}>()

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const toast = useToast()
const submitting = ref(false)

const artifactTypeOptions = [
  { label: '方案', value: 'solution' },
  { label: '需求', value: 'requirement' },
  { label: '设计', value: 'design' },
  { label: '测试报告', value: 'test_report' },
  { label: '部署手册', value: 'deployment_manual' },
  { label: '验收报告', value: 'acceptance_report' },
  { label: '培训材料', value: 'training_material' },
  { label: '运维知识', value: 'ops_knowledge' },
  { label: '客户环境记录', value: 'customer_environment_record' }
]

const state = reactive({
  document_uuid: '',
  artifact_type: 'solution',
  remark: ''
})

watch(() => props.open, (open) => {
  if (open) {
    state.document_uuid = ''
    state.artifact_type = 'solution'
    state.remark = ''
  }
})

async function handleSubmit() {
  if (!props.delivery?.delivery_code) return

  if (!state.document_uuid.trim()) {
    toast.add({ title: '缺少文档 UUID', description: '请填写 Codocs 文档 UUID。', color: 'warning' })
    return
  }

  submitting.value = true
  try {
    await $fetch<ApiResponse<Record<string, unknown>>>(`/api/v1/deliveries/${encodeURIComponent(props.delivery.delivery_code)}/documents`, {
      method: 'POST',
      body: {
        document_uuid: state.document_uuid.trim(),
        artifact_type: state.artifact_type,
        remark: state.remark.trim() || null
      }
    })

    toast.add({ title: '文档已关联', description: '交付成果已纳入资产包。', color: 'success', icon: 'i-lucide-check' })
    emit('created')
    isOpen.value = false
  } catch (error) {
    console.error('[DeliveryDocumentLink] Failed:', error)
    toast.add({ title: '关联失败', description: '请检查文档 UUID 或交付编号后重试。', color: 'error', icon: 'i-lucide-circle-alert' })
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    title="关联交付文档"
    description="将 Codocs 文档按交付成果类型纳入当前客户交付资产包。"
    :ui="{ content: 'sm:max-w-2xl' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <UFormField label="文档 UUID" required>
          <UInput
            v-model="state.document_uuid"
            placeholder="例如：2f69a5d0-7f5f-4d74-8c52-..."
            class="w-full"
          />
        </UFormField>

        <UFormField label="成果类型">
          <USelect
            v-model="state.artifact_type"
            :items="artifactTypeOptions"
            class="w-full"
          />
        </UFormField>

        <UFormField label="说明">
          <UTextarea
            v-model="state.remark"
            :rows="3"
            placeholder="补充里程碑、客户环境、验收批次或文档用途"
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
        <UButton :loading="submitting" icon="i-lucide-link" @click="handleSubmit">
          确认关联
        </UButton>
      </div>
    </template>
  </UModal>
</template>
