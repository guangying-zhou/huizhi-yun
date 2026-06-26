const pageTitle = ref('')

export function usePageTitle(title?: string | Ref<string>) {
  if (title !== undefined) {
    if (isRef(title)) {
      const stop = watch(title, (v) => {
        pageTitle.value = v
      }, { immediate: true })
      if (getCurrentInstance()) {
        onUnmounted(stop)
      }
    } else {
      pageTitle.value = title
    }
  }
  return pageTitle
}
