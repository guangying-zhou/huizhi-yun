<script setup lang="ts">
const colorMode = useColorMode()
const { appName, appLogo } = useAppInfo()
const config = useRuntimeConfig()

const color = computed(() => colorMode.value === 'dark' ? '#1b1718' : 'white')
const appBaseURL = String(config.app?.baseURL || '/')
const faviconPath = `${appBaseURL}${'favicon.png'}`.replace(/\/{2,}/g, '/')

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

const title = appName
const description = ''

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description,
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
  </UApp>
</template>
