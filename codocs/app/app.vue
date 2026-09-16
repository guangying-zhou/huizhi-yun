<script setup lang="ts">
const colorMode = useColorMode()
const { user } = useAuth()
const config = useRuntimeConfig()

const color = computed(() => colorMode.value === 'dark' ? '#1b1718' : 'white')
const appBaseURL = String(config.app?.baseURL || '/')
const faviconPath = `${appBaseURL}${'favicon.png'}`.replace(/\/{2,}/g, '/')

// 全局快捷创建文档 Ctrl+K / ⌘+K（仅登录后生效）
const { registerShortcut } = useQuickCreateDoc()
watch(user, (uid) => {
  if (uid) registerShortcut()
}, { immediate: true })

useHead({
  meta: [
    { charset: 'utf-8' },
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    { key: 'theme-color', name: 'theme-color', content: color }
  ],
  link: [
    { rel: 'icon', type: 'image/png', sizes: '64x64', href: faviconPath }
  ],
  htmlAttrs: {
    lang: 'en'
  }
})

// 应用信息（从 Account 获取，兜底"汇智云"）
const { appName, appLogo } = useAppInfo()

useSeoMeta({
  title: appName,
  ogTitle: appName,
  ogImage: appLogo,
  twitterImage: appLogo,
  twitterCard: 'summary_large_image'
})

// 捕获并抑制导航相关的 parentNode 错误
onErrorCaptured((err: Error) => {
  if (err?.message?.includes('parentNode')
    || err?.message?.includes('Cannot read properties of null')
    || err?.message?.includes('reading \'parentNode\'')) {
    console.warn('[App Error Suppressed]', err.message)
    return false
  }
  return true
})
</script>

<template>
  <UApp>
    <NuxtLoadingIndicator />

    <NuxtLayout>
      <NuxtPage :transition="false" />
    </NuxtLayout>

    <QuickCreateDocModal v-if="user" />
  </UApp>
</template>
