<script setup lang="ts">
import type { ApiResponse, AssetDetail } from '~/types'

const props = defineProps<{
  open: boolean
  asset?: AssetDetail | null
  defaultActionType?: string | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'created': []
}>()

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const { loadDictionaries, getOptions } = useAssetDictionaries()
await loadDictionaries()

const toast = useToast()
const submitting = ref(false)
const actionTypeOptions = computed(() => getOptions('assignment_action_type'))
const targetTypeOptions = computed(() => getOptions('assignment_target_type'))
const assignmentStatusOptions = computed(() => getOptions('assignment_status'))

const state = reactive({
  asset_id: '',
  action_type: 'assign',
  target_type: 'user',
  target_ref: '',
  quantity: '',
  status: 'pending',
  workflow_instance_id: '',
  effective_at: '',
  note: ''
})

const isTargetRequired = computed(() => ['assign', 'claim', 'transfer'].includes(state.action_type) || state.target_type !== 'none')

function applyActionPreset(actionType: string) {
  state.action_type = actionType

  if (['return', 'release', 'scrap'].includes(actionType)) {
    state.target_type = 'none'
    state.target_ref = ''
    state.status = 'pending'
    return
  }

  state.target_type = 'user'
  state.status = 'pending'
}

function resetState() {
  state.asset_id = props.asset?.id ? String(props.asset.id) : ''
  state.target_ref = ''
  state.quantity = ''
  state.workflow_instance_id = ''
  state.effective_at = ''
  state.note = ''
  applyActionPreset(props.defaultActionType || 'assign')
}

watch(() => props.open, (open) => {
  if (open) {
    resetState()
  }
})

watch(() => props.defaultActionType, (value) => {
  if (props.open && value) {
    applyActionPreset(value)
  }
})

watch(() => state.action_type, (value) => {
  if (['return', 'release', 'scrap'].includes(value)) {
    state.target_type = 'none'
    state.target_ref = ''
  }
})

async function handleSubmit() {
  const assetId = Number(state.asset_id)

  if (!assetId) {
    toast.add({ title: '缺少资产', description: '请先指定资产 ID。', color: 'warning' })
    return
  }

  if (['assign', 'claim', 'transfer'].includes(state.action_type) && state.target_type === 'none') {
    toast.add({ title: '缺少目标类型', description: '该操作必须指定目标类型。', color: 'warning' })
    return
  }

  if (isTargetRequired.value && !state.target_ref.trim() && state.target_type !== 'none') {
    toast.add({ title: '缺少目标对象', description: '请填写目标对象编码或 UID。', color: 'warning' })
    return
  }

  submitting.value = true

  try {
    await $fetch<ApiResponse<{ id: number }>>('/api/v1/assignments', {
      method: 'POST',
      body: {
        asset_id: assetId,
        action_type: state.action_type.trim() || 'assign',
        target_type: state.target_type.trim() || 'none',
        target_ref: state.target_type === 'none' ? null : (state.target_ref.trim() || null),
        quantity: state.quantity ? Number(state.quantity) : null,
        status: state.status.trim() || 'pending',
        workflow_instance_id: state.workflow_instance_id.trim() || null,
        effective_at: state.effective_at || null,
        note: state.note.trim() || null
      }
    })

    toast.add({
      title: '资产操作已创建',
      description: '操作记录已生成，审批通过后再联动资产主档。',
      color: 'success',
      icon: 'i-lucide-check'
    })

    emit('created')
    isOpen.value = false
  } catch (error) {
    console.error('[AssignmentCreate] Failed:', error)
    toast.add({
      title: '创建失败',
      description: '请检查资产、目标或状态信息后重试。',
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
    title="新增资产操作"
    description="发起分配、领用、转移、归还、释放、续费或报废操作。"
    :ui="{ content: 'sm:max-w-3xl' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <div v-if="asset" class="rounded-lg border border-default bg-accented/40 p-3 text-sm">
          <div class="font-medium">
            {{ asset.asset_name }}
          </div>
          <div class="mt-1 text-muted">
            {{ asset.asset_code }} / 当前使用人：{{ asset.user_uid || '无' }} / 状态：{{ asset.status }}
          </div>
        </div>

        <div class="grid gap-4 md:grid-cols-2">
          <UFormField label="资产 ID" required>
            <UInput
              v-model="state.asset_id"
              :disabled="Boolean(asset)"
              type="number"
              placeholder="例如：1"
              class="w-full"
            />
          </UFormField>

          <UFormField label="操作类型">
            <USelect
              v-model="state.action_type"
              :items="actionTypeOptions"
              placeholder="请选择操作类型"
              class="w-full"
            />
          </UFormField>

          <UFormField label="目标类型">
            <USelect
              v-model="state.target_type"
              :items="targetTypeOptions"
              placeholder="请选择目标类型"
              class="w-full"
            />
          </UFormField>

          <UFormField label="操作状态">
            <USelect
              v-model="state.status"
              :items="assignmentStatusOptions"
              placeholder="请选择操作状态"
              class="w-full"
            />
          </UFormField>

          <UFormField label="流程实例号">
            <UInput
              v-model="state.workflow_instance_id"
              placeholder="例如：WF-ASSET-202606-001"
              class="w-full"
            />
          </UFormField>

          <UFormField :label="state.target_type === 'user' ? '目标 UID' : '目标编码'" :required="isTargetRequired && state.target_type !== 'none'">
            <UInput
              v-model="state.target_ref"
              :disabled="state.target_type === 'none'"
              :placeholder="state.target_type === 'user' ? '例如：U1004' : '例如：delivery/hljt-crm / ENV-HLJT-PROD'"
              class="w-full"
            />
          </UFormField>

          <UFormField label="数量">
            <UInput
              v-model="state.quantity"
              type="number"
              placeholder="可选，适用于 Seat / 配额 / 批量资产"
              class="w-full"
            />
          </UFormField>

          <UFormField class="md:col-span-2" label="计划生效时间">
            <UInput
              v-model="state.effective_at"
              type="datetime-local"
              class="w-full"
            />
          </UFormField>
        </div>

        <UFormField label="说明">
          <UTextarea
            v-model="state.note"
            :rows="4"
            placeholder="补充操作背景、去向、审批说明或异常备注"
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
          创建操作
        </UButton>
      </div>
    </template>
  </UModal>
</template>
