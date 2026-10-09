<script setup lang="ts">
const props = defineProps<{ rows: Record<string, unknown>[] }>()
const model = defineModel<string>({ required: true })
const selected = computed({ get: () => model.value.split(',').map(v => v.trim()).filter(Boolean), set: (values: string[]) => {
  model.value = values.join(',')
} })
const options = computed(() => props.rows.map(row => ({ value: String(row.code), label: `${String(row.name || row.term_name || '当前记录')}（${String(row.code)}）` })))
</script>

<template>
  <USelectMenu
    v-model="selected"
    :items="options"
    value-key="value"
    multiple
    placeholder="搜索选择已有记录"
    class="w-full"
  />
</template>
