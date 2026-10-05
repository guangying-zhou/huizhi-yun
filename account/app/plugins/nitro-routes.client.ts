/**
 * 将 /_nitro/* 路径转为硬导航，避免 Vue Router 拦截并产生警告。
 */
export default defineNuxtPlugin(() => {
  const router = useRouter()
  router.beforeEach((to) => {
    if (to.path.startsWith('/_nitro')) {
      window.location.href = to.fullPath
      return false
    }
  })
})
