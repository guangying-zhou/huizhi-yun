<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()
const config = useRuntimeConfig()
const appLogo = computed(() => String(config.public.appLogo || '/enterprise/logo.svg'))
const forbidden = computed(() => Number(props.error.statusCode || 500) === 403)
const retired = computed(() => Number(props.error.statusCode || 500) === 410)
const notFound = computed(() => Number(props.error.statusCode || 500) === 404)
// Served through the Gateway's Host asset path; bound (not a literal src) so Vite does not try to bundle it.
const notFoundIllustration = '/enterprise/illustrations/404.svg'

useHead({
  title: () => retired.value ? '此入口已下线' : notFound.value ? '页面不存在' : forbidden.value ? '无权限访问此页面' : '页面暂时无法打开',
  htmlAttrs: { lang: 'zh-CN' }
})

// The Host workbench is the one safe landing place, whichever page failed.
function returnToWorkbench() {
  return clearError({ redirect: '/enterprise' })
}
</script>

<template>
  <UApp>
    <main class="flex min-h-svh flex-col bg-default px-4 py-6 sm:px-10 sm:py-8">
      <header class="flex items-center gap-2 font-semibold text-highlighted">
        <img
          :src="appLogo"
          alt=""
          class="size-7 shrink-0 object-contain"
          width="28"
          height="28"
        >
        <span>汇智云</span>
      </header>

      <section
        class="m-auto flex w-full max-w-md flex-col items-center gap-6 py-10 text-center"
        aria-labelledby="error-title"
      >
        <img
          v-if="notFound"
          :src="notFoundIllustration"
          alt=""
          class="w-full max-w-72"
          width="288"
          height="216"
        >
        <UIcon
          v-else
          name="i-lucide-triangle-alert"
          class="size-12 text-warning"
        />
        <div class="space-y-2">
          <h1
            id="error-title"
            class="text-xl font-semibold text-highlighted"
          >
            {{ retired ? '此入口已下线' : notFound ? '页面不存在' : forbidden ? '无权限访问此页面' : '页面暂时无法打开' }}
          </h1>
          <p class="text-sm text-muted">
            {{ retired ? '此旧入口已停止使用，请回到工作台打开现有文档或项目功能。' : notFound ? '您访问的页面不存在或已被移除，请检查网址是否正确。' : forbidden ? '当前账号没有此页面的访问权限，请联系管理员。' : '请稍后重试，或先回到工作台。' }}
          </p>
        </div>
        <UButton
          size="lg"
          icon="i-lucide-house"
          @click="returnToWorkbench"
        >
          回到工作台
        </UButton>
      </section>
    </main>
  </UApp>
</template>
