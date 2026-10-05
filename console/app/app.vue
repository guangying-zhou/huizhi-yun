<script setup lang="ts">
const colorMode = useColorMode()
const config = useRuntimeConfig()

const color = computed(() => colorMode.value === 'dark' ? '#1b1718' : 'white')
const appBaseURL = String(config.app?.baseURL || '/')
const logoPath = `${appBaseURL}${'logo.svg'}`.replace(/\/{2,}/g, '/')
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

const title = '汇智云'
const description = '一体化数智企业管理平台'

useSeoMeta({
  title,
  description,
  ogTitle: title,
  ogDescription: description,
  ogImage: logoPath,
  twitterImage: logoPath,
  twitterCard: 'summary_large_image'
})

function applicationShellPageKey(route: { path: string, fullPath: string }) {
  return route.path.startsWith('/shell/') ? 'enterprise-application-shell' : route.fullPath
}
</script>

<template>
  <UApp>
    <NuxtLoadingIndicator />

    <NuxtLayout>
      <NuxtPage
        :transition="false"
        :page-key="applicationShellPageKey"
      />
    </NuxtLayout>
  </UApp>
</template>
