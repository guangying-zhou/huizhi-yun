import type { WatchSource } from 'vue'

type RequestInput = string | (() => string)
type QueryInput = Record<string, unknown> | (() => Record<string, unknown>)

function resolveInput<T>(input: T | (() => T)): T {
  return typeof input === 'function' ? (input as () => T)() : input
}

export function usePlatformData<T>(
  request: RequestInput,
  options: {
    query?: QueryInput
    watch?: WatchSource[]
  } = {}
) {
  const data = ref<T | null>(null)
  const pending = ref(false)
  const error = ref<unknown>(null)

  async function refresh() {
    pending.value = true
    error.value = null
    try {
      data.value = await $fetch(resolveInput(request), {
        query: options.query ? resolveInput(options.query) : undefined
      }) as T
    } catch (caught) {
      error.value = caught
    } finally {
      pending.value = false
    }
  }

  if (options.watch?.length) {
    watch(options.watch, () => {
      void refresh()
    })
  }

  return {
    data,
    pending,
    error,
    refresh
  }
}
