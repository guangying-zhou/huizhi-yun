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
const environmentTypeOptions = computed(() => getOptions('environment_type'))
const environmentStatusOptions = computed(() => getOptions('environment_status'))

const state = reactive({
  environment_name: '',
  environment_type: 'test',
  project_code: '',
  customer_code: '',
  contract_code: '',
  status: 'planning',
  dept_code: 'DELIVERY',
  owner_uid: '',
  maintainer_uid: '',
  topology_summary: '',
  notes: ''
})

function resetState() {
  state.environment_name = ''
  state.environment_type = 'test'
  state.project_code = ''
  state.customer_code = ''
  state.contract_code = ''
  state.status = 'planning'
  state.dept_code = 'DELIVERY'
  state.owner_uid = ''
  state.maintainer_uid = ''
  state.topology_summary = ''
  state.notes = ''
}

watch(() => props.open, (open) => {
  if (open) {
    resetState()
  }
})

async function handleSubmit() {
  if (!state.environment_name.trim()) {
    toast.add({ title: '缺少环境名称', description: '请先填写环境名称。', color: 'warning' })
    return
  }

  submitting.value = true

  try {
    const response = await $fetch<ApiResponse<{ id: number }>>('/api/v1/environments', {
      method: 'POST',
      body: {
        environment_name: state.environment_name.trim(),
        environment_type: state.environment_type.trim() || 'test',
        project_code: state.project_code.trim() || 'UNKNOWN',
        customer_code: state.customer_code.trim() || null,
        contract_code: state.contract_code.trim() || null,
        status: state.status.trim() || 'planning',
        dept_code: state.dept_code.trim() || null,
        owner_uid: state.owner_uid.trim() || null,
        maintainer_uid: state.maintainer_uid.trim() || null,
        topology_summary: state.topology_summary.trim() || null,
        notes: state.notes.trim() || null
      }
    })

    toast.add({
      title: '环境已创建',
      description: `已生成环境记录 #${response.data.id}`,
      color: 'success',
      icon: 'i-lucide-check'
    })

    emit('created', response.data.id)
    isOpen.value = false
  } catch (error) {
    console.error('[EnvironmentCreate] Failed:', error)
    toast.add({
      title: '创建失败',
      description: '请检查项目编码或稍后重试。',
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
    title="新增环境"
    description="录入项目、客户、合同和责任人等环境基础信息。"
    :ui="{ content: 'sm:max-w-4xl' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <UFormField label="环境名称" required>
          <UInput
            v-model="state.environment_name"
            placeholder="例如：华联交通 CRM 验收环境"
            class="w-full"
          />
        </UFormField>

        <div class="grid gap-4 md:grid-cols-2">
          <UFormField label="环境类型">
            <USelect
              v-model="state.environment_type"
              :items="environmentTypeOptions"
              placeholder="请选择环境类型"
              class="w-full"
            />
          </UFormField>

          <UFormField label="状态">
            <USelect
              v-model="state.status"
              :items="environmentStatusOptions"
              placeholder="请选择环境状态"
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

          <UFormField label="归属部门">
            <UInput
              v-model="state.dept_code"
              placeholder="例如：DELIVERY"
              class="w-full"
            />
          </UFormField>

          <UFormField label="负责人 UID">
            <UInput
              v-model="state.owner_uid"
              placeholder="例如：U1001"
              class="w-full"
            />
          </UFormField>

          <UFormField label="维护人 UID">
            <UInput
              v-model="state.maintainer_uid"
              placeholder="例如：U1005"
              class="w-full"
            />
          </UFormField>
        </div>

        <UFormField label="拓扑摘要">
          <UTextarea
            v-model="state.topology_summary"
            :rows="3"
            placeholder="简述核心资源、数据库、证书或外部暴露链路"
            class="w-full"
          />
        </UFormField>

        <UFormField label="备注">
          <UTextarea
            v-model="state.notes"
            :rows="4"
            placeholder="补充环境用途、上线节奏或维护说明"
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
