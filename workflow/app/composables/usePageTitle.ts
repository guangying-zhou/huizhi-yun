const pageTitle = ref('')

export function usePageTitle(title?: string | Ref<string>) {
  if (title !== undefined) {
    if (isRef(title)) {
      watch(title, (v) => {
        pageTitle.value = v
      }, { immediate: true })
    } else {
      pageTitle.value = title
    }
  }
  return pageTitle
}
