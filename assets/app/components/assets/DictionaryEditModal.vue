<script setup lang="ts">
import type { ApiResponse } from '~/types'
import type { AssetDictionaryDefinition } from '~~/shared/assetsDictionaries'

const props = defineProps<{
  open: boolean
  dictionary: AssetDictionaryDefinition | null
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'updated': []
}>()

const isOpen = computed({
  get: () => props.open,
  set: value => emit('update:open', value)
})

const toast = useToast()
const submitting = ref(false)

interface EditableOption {
  label: string
  value: string
  description: string
  enabled: boolean
  sortOrder: number
}

const state = reactive({
  name: '',
  description: '',
  options: [] as EditableOption[]
})

function hydrate() {
  state.name = props.dictionary?.name || ''
  state.description = props.dictionary?.description || ''
  state.options = (props.dictionary?.options || []).map((option, index) => ({
    label: option.label,
    value: option.value,
    description: option.description || '',
    enabled: option.enabled !== false,
    sortOrder: option.sortOrder ?? index + 1
  }))
}

watch(() => props.open, (open) => {
  if (open) {
    hydrate()
  }
})

watch(() => props.dictionary, () => {
  if (props.open) {
    hydrate()
  }
})

function addOption() {
  state.options.push({
    label: '',
    value: '',
    description: '',
    enabled: true,
    sortOrder: state.options.length + 1
  })
}

function removeOption(index: number) {
  state.options.splice(index, 1)
  state.options.forEach((option, optionIndex) => {
    option.sortOrder = optionIndex + 1
  })
}

async function handleSubmit() {
  if (!props.dictionary?.code) {
    return
  }

  submitting.value = true

  try {
    await $fetch<ApiResponse<AssetDictionaryDefinition>>(`/api/v1/admin/dictionaries/${props.dictionary.code}`, {
      method: 'PUT',
      body: {
        name: state.name.trim(),
        description: state.description.trim(),
        options: state.options.map(option => ({
          label: option.label.trim(),
          value: option.value.trim(),
          description: option.description.trim(),
          enabled: option.enabled,
          sortOrder: option.sortOrder
        }))
      }
    })

    toast.add({
      title: '字典已更新',
      description: '新的字典项会立即影响下拉选择。',
      color: 'success',
      icon: 'i-lucide-check'
    })

    emit('updated')
    isOpen.value = false
  } catch (error) {
    console.error('[DictionaryEdit] Failed:', error)
    toast.add({
      title: '保存失败',
      description: '请检查字典项的标签和值是否完整。',
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
    :title="dictionary ? `编辑字典：${dictionary.name}` : '编辑字典'"
    description="维护系统内固定选项，主录入表单会直接使用这些字典项。"
    :ui="{ content: 'sm:max-w-5xl' }"
  >
    <template #body>
      <div class="space-y-4 p-4">
        <div class="grid gap-4 md:grid-cols-2">
          <UFormField label="字典名称">
            <UInput
              v-model="state.name"
              class="w-full"
            />
          </UFormField>

          <UFormField label="字典说明">
            <UInput
              v-model="state.description"
              class="w-full"
            />
          </UFormField>
        </div>

        <div class="flex items-center justify-between">
          <div>
            <p class="font-medium">
              字典项
            </p>
            <p class="text-sm text-muted">
              维护标签、存储值、描述和启用状态。
            </p>
          </div>

          <UButton icon="i-lucide-plus" size="sm" @click="addOption">
            新增字典项
          </UButton>
        </div>

        <div class="space-y-3">
          <UCard
            v-for="(option, index) in state.options"
            :key="`${dictionary?.code || 'dict'}-${index}`"
            variant="subtle"
          >
            <div class="grid gap-3 md:grid-cols-[1fr_1fr_1.2fr_auto_auto] md:items-center">
              <UFormField label="标签">
                <UInput
                  v-model="option.label"
                  placeholder="例如：运行中"
                  class="w-full"
                />
              </UFormField>

              <UFormField label="值">
                <UInput
                  v-model="option.value"
                  placeholder="例如：active"
                  class="w-full"
                />
              </UFormField>

              <UFormField label="说明">
                <UInput
                  v-model="option.description"
                  placeholder="可选"
                  class="w-full"
                />
              </UFormField>

              <UFormField label="排序">
                <UInput v-model="option.sortOrder" type="number" class="w-24" />
              </UFormField>

              <div class="flex items-end gap-2">
                <USwitch v-model="option.enabled" label="启用" />
                <UButton
                  icon="i-lucide-trash-2"
                  color="error"
                  variant="ghost"
                  square
                  @click="removeOption(index)"
                />
              </div>
            </div>
          </UCard>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-3">
        <UButton color="neutral" variant="outline" @click="isOpen = false">
          取消
        </UButton>
        <UButton :loading="submitting" icon="i-lucide-save" @click="handleSubmit">
          保存字典
        </UButton>
      </div>
    </template>
  </UModal>
</template>
