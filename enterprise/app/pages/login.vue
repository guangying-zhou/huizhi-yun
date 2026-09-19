<script setup lang="ts">
import { safeLoginRedirect } from '../../shared/session-cache.mjs'
definePageMeta({ layout: false, alias: ['/aims/login', '/assets/login', '/enterprise/login'] })
const route = useRoute()
const config = useRuntimeConfig()
const configured = computed(() => Boolean(String(config.public.consoleUrl || '').trim()))
const redirect = computed(() => safeLoginRedirect(route.query.redirect) === '/' ? '/aims/' : safeLoginRedirect(route.query.redirect))
function login() {
  if (!configured.value) return
  window.location.assign(`${config.public.authApiPrefix || ''}/api/auth/oidc-login?${new URLSearchParams({ redirect: redirect.value })}`)
}
</script>

<template>
  <main class="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
    <h1 class="text-2xl font-semibold">登录汇智云</h1>
    <UAlert v-if="!configured" title="登录服务尚未配置" description="请联系企业管理员完成登录服务配置。" color="warning" />
    <UButton :disabled="!configured" icon="i-lucide-log-in" @click="login">使用企业账号登录</UButton>
  </main>
</template>
