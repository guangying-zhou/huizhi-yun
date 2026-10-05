const pageTitle = ref('')

export function usePageTitle(title?: string | Ref<string>) {
  if (title !== undefined) {
    if (isRef(title)) {
      const stop = watch(title, (v) => {
        pageTitle.value = v
      }, { immediate: true })
      if (getCurrentInstance()) {
        onUnmounted(() => {
          stop()
          if (pageTitle.value === title.value) pageTitle.value = ''
        })
      }
    } else {
      pageTitle.value = title
      if (getCurrentInstance()) {
        onUnmounted(() => {
          if (pageTitle.value === title) pageTitle.value = ''
        })
      }
    }
  }
  return pageTitle
}
