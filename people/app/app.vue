<script setup lang="ts">
const colorMode = useColorMode()
const { appName, appLogo } = useAppInfo()
const config = useRuntimeConfig()

const color = computed(() => colorMode.value === 'dark' ? '#18181b' : 'white')
const appBaseURL = String(config.app?.baseURL || '/')
const faviconPath = `${appBaseURL}favicon.png`.replace(/\/{2,}/g, '/')

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
    lang: 'zh-CN'
  }
})

const description = '汇智云人员事实、任职、成本快照与项目贡献绩效'

useSeoMeta({
  title: appName,
  description,
  ogTitle: appName,
  ogDescription: description,
  ogImage: appLogo,
  twitterImage: appLogo,
  twitterCard: 'summary'
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
