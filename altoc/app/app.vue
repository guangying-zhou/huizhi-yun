<script setup lang="ts">
const colorMode = useColorMode()
const runtimeConfig = useRuntimeConfig()

const color = computed(() => colorMode.value === 'dark' ? '#1b1718' : 'white')
const appBaseURL = runtimeConfig.app.baseURL.endsWith('/') ? runtimeConfig.app.baseURL : `${runtimeConfig.app.baseURL}/`

useHead({
  meta: [
    { charset: 'utf-8' },
    { name: 'viewport', content: 'width=device-width, initial-scale=1' },
    { key: 'theme-color', name: 'theme-color', content: color }
  ],
  link: [
    { rel: 'icon', href: `${appBaseURL}logo.png` }
  ],
  htmlAttrs: {
    lang: 'en'
  }
})

const title = '汇智云经营'
const description = ''

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description,
  ogImage: '/logo.png',
  twitterImage: '/logo.png',
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
