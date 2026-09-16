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
const baseTypeOptions = computed(() => getOptions('technology_base_type'))
const baseStatusOptions = computed(() => getOptions('technology_base_status'))
const assetLevelOptions = computed(() => getOptions('asset_level'))

const state = reactive({
  base_code: '',
  base_name: '',
  base_type: 'platform',
  status: 'active',
  service_targets: '',
  asset_level: 'B',
  notes: ''
})

function hydrate() {
  state.base_code = ''
  state.base_name = ''
  state.base_type = 'platform'
  state.status = 'active'
  state.service_targets = ''
  state.asset_level = 'B'
  state.notes = ''
}

watch(() => props.open, (open) => {
  if (open) {
    hydrate()
  }
})

async function handleSubmit() {
  if (!state.base_name.trim()) {
    toast.add({ title: '缺少底座名称', description: '请先填写技术底座名称。', color: 'warning' })
    return
  }

  submitting.value = true

  try {
    const response = await $fetch<ApiResponse<{ id: number }>>('/api/v1/technology-bases', {
      method: 'POST',
      body: {
        base_code: state.base_code.trim() || null,
        base_name: state.base_name.trim(),
        base_type: state.base_type,
        status: state.status,
        service_targets: state.service_targets.trim() || null,
        asset_level: state.asset_level || null,
        notes: state.notes.trim() || null
      }
    })

    toast.add({
      title: '技术底座已创建',
      description: '可以继续在详情页关联产品。',
      color: 'success',
      icon: 'i-lucide-check'
    })

    emit('created', response.data.id)
    isOpen.value = false
  } catch (error) {
    console.error('[TechnologyBaseCreate] Failed:', error)
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
    title="新增技术底座"
    description="登记基础平台、中台能力、共用模块和工具底座。"
    :ui="{ content: 'sm:max-w-3xl' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <div class="grid gap-4 md:grid-cols-2">
          <UFormField label="底座编号">
            <UInput
              v-model="state.base_code"
              placeholder="留空自动生成"
              class="w-full"
            />
          </UFormField>

          <UFormField label="底座名称" required>
            <UInput
              v-model="state.base_name"
              placeholder="例如：AI 推理与额度运行底座"
              class="w-full"
            />
          </UFormField>

          <UFormField label="底座类型">
            <USelect
              v-model="state.base_type"
              :items="baseTypeOptions"
              class="w-full"
            />
          </UFormField>

          <UFormField label="当前状态">
            <USelect
              v-model="state.status"
              :items="baseStatusOptions"
              class="w-full"
            />
          </UFormField>

          <UFormField label="资产分级">
            <USelect
              v-model="state.asset_level"
              :items="assetLevelOptions"
              class="w-full"
            />
          </UFormField>
        </div>

        <UFormField label="服务对象">
          <UTextarea
            v-model="state.service_targets"
            :rows="3"
            placeholder="说明该底座服务哪些产品、环境或业务线"
            class="w-full"
          />
        </UFormField>

        <UFormField label="备注">
          <UTextarea
            v-model="state.notes"
            :rows="4"
            placeholder="补充技术边界、替换计划或注意事项"
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
          创建
        </UButton>
      </div>
    </template>
  </UModal>
</template>
