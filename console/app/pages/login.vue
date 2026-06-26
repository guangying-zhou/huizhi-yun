<script setup lang="ts">
definePageMeta({
  layout: false
})

const route = useRoute()
const config = useRuntimeConfig()
const { cookieOptions } = useCookieOptions()
const { resolveCurrentAppUrl } = useAppUrls()
const logoutMarker = useCookie<string | null | undefined>('console_logged_out', cookieOptions())
const loginConfig = ref({
  ssoOidcEnable: Boolean(config.public.ssoOidcEnable),
  casEnable: Boolean(config.public.casEnable),
  wecomCorpid: String(config.public.wecomCorpid || ''),
  wecomAgentid: String(config.public.wecomAgentid || '')
})
const loadingLoginConfig = ref(false)
const redirecting = ref(false)
const loginError = ref('')

const redirectTarget = computed(() => {
  const raw = route.query.redirect
  if (typeof raw === 'string' && raw.trim()) {
    return raw.trim()
  }
  return '/'
})

const loggedOut = computed(() => {
  return logoutMarker.value === '1' || route.query.logged_out === '1' || route.query.state === 'logged_out'
})

function resolveRedirectUrl() {
  if (redirectTarget.value.startsWith('http://') || redirectTarget.value.startsWith('https://')) {
    return redirectTarget.value
  }

  return resolveCurrentAppUrl(redirectTarget.value)
}

function hasLoginMethod() {
  return Boolean(
    loginConfig.value.ssoOidcEnable
    || loginConfig.value.casEnable
    || (loginConfig.value.wecomCorpid && loginConfig.value.wecomAgentid)
  )
}

async function loadLoginConfig() {
  if (loadingLoginConfig.value) {
    return
  }

  loadingLoginConfig.value = true
  const dynamicLoginConfig = await $fetch<{
    code: number
    data?: {
      ssoOidcEnable?: boolean
      casEnable?: boolean
      wecomCorpid?: string
      wecomAgentid?: string
    }
  }>(resolveCurrentAppUrl('/api/auth/login-config')).catch(() => null)

  if (dynamicLoginConfig?.data) {
    loginConfig.value = {
      ssoOidcEnable: Boolean(dynamicLoginConfig.data.ssoOidcEnable),
      casEnable: Boolean(dynamicLoginConfig.data.casEnable),
      wecomCorpid: String(dynamicLoginConfig.data.wecomCorpid || ''),
      wecomAgentid: String(dynamicLoginConfig.data.wecomAgentid || '')
    }
  }
  loadingLoginConfig.value = false
}

async function startLocalLogin() {
  loginError.value = ''
  if (!hasLoginMethod()) {
    await loadLoginConfig()
  }

  const forceIdpLogin = loggedOut.value
  const authQuery = new URLSearchParams({
    target_app: String(config.public.appCode || 'console'),
    redirect: resolveRedirectUrl(),
    force: '1'
  })
  if (forceIdpLogin) {
    authQuery.set('prompt', 'login')
  }
  const isWeWork = /wxwork/i.test(navigator.userAgent)
  const wecomConfigured = Boolean(loginConfig.value.wecomCorpid && loginConfig.value.wecomAgentid)

  if (isWeWork && wecomConfigured) {
    redirecting.value = true
    window.location.assign(resolveCurrentAppUrl(`/api/auth/wecom-login?${authQuery.toString()}`))
    return
  }

  if (loginConfig.value.ssoOidcEnable) {
    redirecting.value = true
    window.location.assign(resolveCurrentAppUrl(`/api/auth/oidc-login?${authQuery.toString()}`))
    return
  }

  if (wecomConfigured) {
    redirecting.value = true
    window.location.assign(resolveCurrentAppUrl(`/api/auth/wecom-login?${authQuery.toString()}`))
    return
  }

  if (loginConfig.value.casEnable) {
    redirecting.value = true
    window.location.assign(resolveCurrentAppUrl(`/api/auth/cas-login?${authQuery.toString()}`))
    return
  }

  loginError.value = '当前入口未配置 Console 登录方式。请通过企业专属域名访问，或在 Platform 部署管理中配置 Console 登录入口并重新生成 policy bundle。'
}

const statusIcon = computed(() => {
  if (loggedOut.value) return 'i-lucide-log-out'
  if (loginError.value) return 'i-lucide-circle-alert'
  return 'i-lucide-loader-2'
})

const statusText = computed(() => {
  if (loggedOut.value) return '已退出登录'
  if (loginError.value) return '无法跳转登录'
  return '正在跳转登录...'
})

const isBusy = computed(() => !loggedOut.value && !loginError.value && (loadingLoginConfig.value || redirecting.value || hasLoginMethod()))

onMounted(async () => {
  await loadLoginConfig()

  if (loggedOut.value) {
    return
  }

  const current = await $fetch<{
    code: number
    data?: {
      authenticated?: boolean
    }
  }>(resolveCurrentAppUrl('/api/v1/console/auth/me')).catch(() => null)

  if (current?.data?.authenticated) {
    if (redirectTarget.value.startsWith('http://') || redirectTarget.value.startsWith('https://')) {
      window.location.replace(redirectTarget.value)
      return
    }
    await navigateTo(redirectTarget.value, { replace: true })
    return
  }

  startLocalLogin()
})
</script>

<template>
  <div class="flex items-center justify-center min-h-screen">
    <div class="text-center">
      <UIcon
        :name="statusIcon"
        :class="[
          'size-8 text-primary mx-auto',
          isBusy ? 'animate-spin' : ''
        ]"
      />
      <p class="mt-4 text-muted">
        {{ statusText }}
      </p>
      <p
        v-if="loginError"
        class="mt-2 max-w-md text-sm text-muted"
      >
        {{ loginError }}
      </p>
      <UButton
        v-if="loggedOut"
        class="mt-4"
        icon="i-lucide-log-in"
        :loading="loadingLoginConfig"
        @click="startLocalLogin"
      >
        重新登录
      </UButton>
      <p
        v-if="!loggedOut && !loginError && !loadingLoginConfig && !hasLoginMethod()"
        class="mt-2 text-sm text-muted"
      >
        当前未配置 Console 登录方式。
      </p>
    </div>
  </div>
</template>
