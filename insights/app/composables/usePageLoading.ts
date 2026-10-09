export const usePageLoading = () => {
  const isLoading = ref(true)

  // 页面加载完成后隐藏加载状态
  onMounted(() => {
    // 延迟一小段时间确保样式加载完成
    setTimeout(() => {
      isLoading.value = false
    }, 100)
  })

  // 路由变化时显示加载状态
  const router = useRouter()
  router.beforeEach(() => {
    isLoading.value = true
  })

  router.afterEach(() => {
    // 给页面内容渲染留出时间
    nextTick(() => {
      setTimeout(() => {
        isLoading.value = false
      }, 50)
    })
  })

  return {
    isLoading: readonly(isLoading)
  }
}
