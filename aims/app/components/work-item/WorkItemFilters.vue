<script setup lang="ts">
import { typeOptions, priorityOptions, severityOptions, getStatusOptions } from '~/config/work-item'
import type { WorkItemType } from '~/types/aims'

export interface WorkItemFilterValues {
  type: string
  status: string
  priority: string
  severity: string
  assigneeUid: string
}

const props = defineProps<{
  modelValue: WorkItemFilterValues
  assigneeOptions?: { label: string, value: string }[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: WorkItemFilterValues]
}>()

const filters = computed({
  get: () => props.modelValue,
  set: val => emit('update:modelValue', val)
})

function update(key: keyof WorkItemFilterValues, value: string) {
  emit('update:modelValue', { ...filters.value, [key]: value })
}

const allTypeOptions = computed(() => [
  { label: '全部类型', value: '' },
  ...typeOptions
])

const allPriorityOptions = computed(() => [
  { label: '全部优先级', value: '' },
  ...priorityOptions
])

const allSeverityOptions = computed(() => [
  { label: '全部严重度', value: '' },
  ...severityOptions
])

const statusOptions = computed(() => {
  const type = filters.value.type as WorkItemType | ''
  const opts = type ? getStatusOptions(type as WorkItemType) : getStatusOptions()
  return [{ label: '全部状态', value: '' }, ...opts]
})

const allAssigneeOptions = computed(() => [
  { label: '全部负责人', value: '' },
  ...(props.assigneeOptions || [])
])
</script>

<template>
  <div class="flex flex-wrap items-center gap-2">
    <USelect
      :model-value="filters.type"
      :items="allTypeOptions"
      placeholder="类型"
      class="w-32"
      @update:model-value="update('type', $event)"
    />
    <USelect
      :model-value="filters.status"
      :items="statusOptions"
      placeholder="状态"
      class="w-32"
      @update:model-value="update('status', $event)"
    />
    <USelect
      :model-value="filters.priority"
      :items="allPriorityOptions"
      placeholder="优先级"
      class="w-36"
      @update:model-value="update('priority', $event)"
    />
    <USelect
      :model-value="filters.severity"
      :items="allSeverityOptions"
      placeholder="严重度"
      class="w-36"
      @update:model-value="update('severity', $event)"
    />
    <USelect
      v-if="assigneeOptions && assigneeOptions.length > 0"
      :model-value="filters.assigneeUid"
      :items="allAssigneeOptions"
      placeholder="负责人"
      class="w-32"
      @update:model-value="update('assigneeUid', $event)"
    />
  </div>
</template>
