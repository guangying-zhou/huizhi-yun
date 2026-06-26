<script setup lang="ts">
const props = defineProps<{
  modelValue: string
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const keyword = ref('')

const { data: users } = useFetch('/api/v1/teams/users', {
  query: computed(() => ({ keyword: keyword.value })),
  transform: (res: any) => res.data || []
})

const options = computed(() => {
  if (!users.value?.length) {
    // 如果 Account 不可用，至少显示当前值
    if (props.modelValue) {
      return [{ label: props.modelValue, value: props.modelValue }]
    }
    return []
  }
  return users.value.map((u: any) => ({
    label: u.real_name ? `${u.real_name} (${u.uid})` : u.uid,
    value: u.uid
  }))
})

const selected = computed({
  get: () => props.modelValue,
  set: (val: string) => emit('update:modelValue', val)
})
</script>

<template>
  <USelect
    v-model="selected"
    :items="options"
    searchable
    :placeholder="placeholder || '选择负责人'"
    class="w-full"
    @update:search-term="(v: string) => keyword = v"
  />
</template>
