<script setup lang="ts">
import { computed, onMounted } from 'vue'

definePageMeta({
  layout: false
})

const route = useRoute()
const runtimeConfig = useRuntimeConfig()

// Detection for WeWork environment
const isWeWorkBrowser = computed(() => {
  if (typeof window === 'undefined') return false
  return /wxwork/i.test(navigator.userAgent)
})
const wecomEnabled = computed(() => Boolean(runtimeConfig.public.wecomEnabled))

const targetApp = computed(() => {
  const raw = route.query.target_app
  return typeof raw === 'string' && raw.trim() ? raw.trim() : 'account'
})
const redirect = computed(() => {
  const raw = route.query.redirect
  return typeof raw === 'string' && raw.trim() ? raw.trim() : '/'
})

// CAS login URL
const loginWithCas = () => {
  const query = new URLSearchParams({
    target_app: targetApp.value,
    redirect: redirect.value
  })
  window.location.href = `/api/auth/cas-login?${query.toString()}`
}

// Wecom login URL
const loginWithWecom = () => {
  const query = new URLSearchParams({
    target_app: targetApp.value,
    redirect: redirect.value
  })
  window.location.href = `/api/auth/wecom-login?${query.toString()}`
}

// Auto-login for Wecom if in WeWork browser
onMounted(() => {
  if (wecomEnabled.value && isWeWorkBrowser.value) {
    const wecomChecked = useCookie('wecom_checked')
    if (!wecomChecked.value) {
      loginWithWecom()
    }
  }
})
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
    <div class="w-full max-w-md">
      <!-- Logo and Title -->
      <div class="text-center mb-8">
        <img src="/logo.png" alt="Account" class="w-16 h-16 mx-auto mb-4">
        <h1 class="text-2xl font-bold text-gray-900 dark:text-white">
          汇智云账号
        </h1>
        <p class="text-gray-500 dark:text-gray-400 mt-1">
          统一身份认证，安全高效便捷
        </p>
      </div>

      <UCard class="shadow-xl">
        <div class="space-y-4 h-48">
          <div class="text-center mb-8">
            <h2 class="text-lg font-semibold">
              选择登录方式
            </h2>
          </div>

          <UButton
            block
            size="lg"
            icon="i-lucide-shield-check"
            variant="soft"
            @click="loginWithCas"
          >
            CAS 统一认证登录
          </UButton>

          <UButton
            v-if="wecomEnabled"
            block
            size="lg"
            color="success"
            variant="soft"
            icon="i-lucide-message-circle"
            @click="loginWithWecom"
          >
            {{ isWeWorkBrowser ? '企业微信登录' : '企业微信扫码登录' }}
          </UButton>
        </div>
      </UCard>

      <div class="mt-8 text-center text-sm text-gray-400">
        © {{ new Date().getFullYear() }} 汇智云. All rights reserved.
      </div>
    </div>
  </div>
</template>
