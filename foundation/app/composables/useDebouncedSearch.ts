import { watchDebounced } from '@vueuse/core'

export interface UseDebouncedSearchOptions {
  /** 初始关键字 */
  initial?: string
  /** 防抖延迟（毫秒），默认 300 */
  delay?: number
  /**
   * 防抖生效（关键字实际变化）后的回调。
   * 通常用于重置分页到第 1 页，并按需触发刷新。
   */
  onChange?: (value: string) => void
}

/**
 * 列表搜索防抖。解决三个问题：
 * 1. 逐字符请求：输入框绑定 `search`，请求 query 使用 `debounced`，只有停止输入后才发请求；
 * 2. 回车语义：`@keyup.enter="flush"` 立即用当前输入值查询，无需等待防抖；
 * 3. 翻页后搜索空页：`onChange` 在关键字变化时把分页重置到第 1 页。
 *
 * @example
 * const page = ref(1)
 * const { search: keyword, debounced: debouncedKeyword, flush: onSearchEnter }
 *   = useDebouncedSearch({ onChange: () => { page.value = 1 } })
 *
 * const query = computed(() => ({ page: page.value, keyword: debouncedKeyword.value || undefined }))
 * const { data } = useFetch('/api/v1/xxx', { query })
 * // 模板：<UInput v-model="keyword" @keyup.enter="onSearchEnter" />
 */
export function useDebouncedSearch(options: UseDebouncedSearchOptions = {}) {
  const { initial = '', delay = 300, onChange } = options

  // 绑定到输入框的实时值
  const search = ref(initial)
  // 供请求 query 使用的防抖值：停止输入 delay 毫秒后才更新
  const debounced = ref(initial)

  watchDebounced(
    search,
    (value) => {
      if (debounced.value === value) return
      debounced.value = value
      onChange?.(value)
    },
    { debounce: delay }
  )

  /** 立即用当前输入值触发查询（回车、点击搜索按钮） */
  function flush() {
    if (debounced.value === search.value) return
    debounced.value = search.value
    onChange?.(search.value)
  }

  /** 清空搜索并立即生效 */
  function reset() {
    search.value = ''
    if (debounced.value === '') return
    debounced.value = ''
    onChange?.('')
  }

  return { search, debounced, flush, reset }
}
