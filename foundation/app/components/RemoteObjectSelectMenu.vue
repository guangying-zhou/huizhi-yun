<script setup lang="ts">
import { useInfiniteScroll } from '@vueuse/core'
import CommonEmptyState from './common/EmptyState.vue'

const props = withDefaults(defineProps<{
  items: { value: string, label: string, description?: string, disabled?: boolean }[]
  loading?: boolean
  disabled?: boolean
  error?: string
  hasMore?: boolean
  ignoreFilter?: boolean
  placeholder?: string
}>(), { loading: false, disabled: false, error: '', hasMore: false, ignoreFilter: true, placeholder: '搜索选择有权访问的对象' })
const model = defineModel<string>({ required: true })
const search = defineModel<string>('searchTerm', { default: '' })
const emit = defineEmits<{ loadMore: [], retry: [], flush: [] }>()
const open = ref(false)
const menu = ref<{ viewportRef?: HTMLElement | null } | null>(null)
// Only scroll inside the open popup. Search/scope generations remain owned by
// the data adapter, so old pages cannot be appended to a new query.
useInfiniteScroll(computed(() => menu.value?.viewportRef || null), () => emit('loadMore'), {
  distance: 32,
  canLoadMore: () => open.value && props.hasMore && !props.loading && !props.error && !props.disabled
})
</script>

<template>
  <USelectMenu
    ref="menu"
    v-model="model"
    v-model:open="open"
    v-model:search-term="search"
    :items="items"
    value-key="value"
    :loading="loading"
    :disabled="disabled"
    :ignore-filter="ignoreFilter"
    :placeholder="placeholder"
    :ui="{ viewport: 'max-h-64 overflow-y-auto', itemLabel: 'truncate', itemDescription: 'truncate' }"
    class="w-full min-w-0"
    @keydown.enter="emit('flush')"
  >
    <template #empty>
      <CommonEmptyState :title="loading ? '正在加载' : error ? '列表加载失败' : '暂无可访问记录'" />
    </template>
    <template #content-bottom>
      <div v-if="error || hasMore || loading" class="border-t border-default p-2" data-remote-select-footer>
        <p v-if="error" class="break-words text-sm text-error" role="alert">
          {{ error }}
        </p>
        <UButton
          v-if="error || hasMore"
          color="neutral"
          variant="ghost"
          class="w-full"
          :loading="loading"
          :disabled="disabled"
          @click="error ? emit('retry') : emit('loadMore')"
        >
          {{ error ? '重试加载' : '加载更多' }}
        </UButton>
        <p v-else role="status" class="text-sm text-muted">
          正在加载…
        </p>
      </div>
    </template>
  </USelectMenu>
</template>
