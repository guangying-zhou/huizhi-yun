<script setup lang="ts">
import type { ApiResponse, EnvironmentItem } from '~/types'

const props = defineProps<{
  open: boolean
  environment: EnvironmentItem | null
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
const environmentTypeOptions = computed(() => getOptions('environment_type'))
const environmentStatusOptions = computed(() => getOptions('environment_status'))

const state = reactive({
  environment_name: '',
  environment_type: '',
  status: '',
  project_code: '',
  customer_code: '',
  contract_code: '',
  owner_uid: '',
  maintainer_uid: '',
  topology_summary: '',
  notes: ''
})

function hydrate() {
  state.environment_name = props.environment?.environment_name || ''
  state.environment_type = props.environment?.environment_type || ''
  state.status = props.environment?.status || ''
  state.project_code = props.environment?.project_code || ''
  state.customer_code = props.environment?.customer_code || ''
  state.contract_code = props.environment?.contract_code || ''
  state.owner_uid = props.environment?.owner_uid || ''
  state.maintainer_uid = props.environment?.maintainer_uid || ''
  state.topology_summary = props.environment?.topology_summary || ''
  state.notes = props.environment?.notes || ''
}

watch(() => props.open, (open) => {
  if (open) {
    hydrate()
  }
})

watch(() => props.environment, () => {
  if (props.open) {
    hydrate()
  }
})

async function handleSubmit() {
  if (!props.environment?.id) {
    return
  }

  if (!state.environment_name.trim()) {
    toast.add({ title: '缺少环境名称', description: '请先填写环境名称。', color: 'warning' })
    return
  }

  submitting.value = true

  try {
    await $fetch<ApiResponse<{ id: number }>>(`/api/v1/environments/${props.environment.id}`, {
      method: 'PATCH',
      body: {
        environment_name: state.environment_name.trim(),
        environment_type: state.environment_type.trim() || null,
        status: state.status.trim() || null,
        project_code: state.project_code.trim() || null,
        customer_code: state.customer_code.trim() || null,
        contract_code: state.contract_code.trim() || null,
        owner_uid: state.owner_uid.trim() || null,
        maintainer_uid: state.maintainer_uid.trim() || null,
        topology_summary: state.topology_summary.trim() || null,
        notes: state.notes.trim() || null
      }
    })

    toast.add({
      title: '环境已更新',
      description: '环境主要信息已保存。',
      color: 'success',
      icon: 'i-lucide-check'
    })

    emit('updated')
    isOpen.value = false
  } catch (error) {
    console.error('[EnvironmentEdit] Failed:', error)
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
    title="编辑环境"
    description="维护环境的项目归属、责任人和运行说明。"
    :ui="{ content: 'sm:max-w-3xl' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <UFormField label="环境名称" required>
          <UInput
            v-model="state.environment_name"
            placeholder="环境名称"
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
            placeholder="简述当前核心资源和部署结构"
            class="w-full"
          />
        </UFormField>

        <UFormField label="备注">
          <UTextarea
            v-model="state.notes"
            :rows="4"
            placeholder="补充维护说明、上线节奏或特殊约束"
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
