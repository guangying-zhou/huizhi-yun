<script setup lang="ts">
const props = withDefaults(defineProps<{
  uid: string
  name: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
}>(), {
  size: 'sm'
})

const initials = computed(() => {
  if (!props.name) return '?'
  // 取最后一个字（中文名）或首字母（英文名）
  const trimmed = props.name.trim()
  if (!trimmed) return '?'
  return trimmed.charAt(trimmed.length - 1)
})

const sizeClass: Record<string, string> = {
  xs: 'size-5 text-[10px]',
  sm: 'size-6 text-xs',
  md: 'size-8 text-sm',
  lg: 'size-10 text-base'
}
</script>

<template>
  <div
    :class="[
      'inline-flex items-center justify-center rounded-full bg-(--ui-bg-accented) text-(--ui-text-dimmed) font-medium shrink-0',
      sizeClass[size]
    ]"
    :title="name || uid"
  >
    {{ initials }}
  </div>
</template>
