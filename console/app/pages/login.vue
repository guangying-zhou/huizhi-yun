<script setup lang="ts">
type LoginProvider = 'oidc' | 'cas' | 'wecom' | 'dingtalk'
const DEFAULT_OIDC_DISPLAY_NAME = '企业统一身份登录'
const MAX_OIDC_DISPLAY_NAME_LENGTH = 10

definePageMeta({
  layout: false
})

useSeoMeta({
  title: '登录 · 汇智云数智协同平台',
  description: '选择企业登录方式进入汇智云数智协同平台。'
})

useHead({
  htmlAttrs: {
    lang: 'zh-CN'
  }
})

const route = useRoute()
const config = useRuntimeConfig()
const { cookieOptions } = useCookieOptions()
const { resolveCurrentAppUrl } = useAppUrls()
const logoutMarker = useCookie<string | null | undefined>('console_logged_out', cookieOptions())
const loginConfig = ref({
  mode: 'none',
  enabledProviders: [] as string[],
  ssoOidcEnable: Boolean(config.public.ssoOidcEnable),
  oidcDisplayName: DEFAULT_OIDC_DISPLAY_NAME,
  casEnable: Boolean(config.public.casEnable),
  wecomCorpid: String(config.public.wecomCorpid || ''),
  wecomAgentid: String(config.public.wecomAgentid || ''),
  dingtalkClientId: ''
})
const loadingLoginConfig = ref(false)
const redirecting = ref(false)
const redirectingProvider = ref<LoginProvider | null>(null)
const loginError = ref('')
const acceptedTerms = ref(true)

const productLogo = computed(() => resolveCurrentAppUrl('/brand/hzy-logo.png'))
const officialSiteUrl = 'https://www.wiztek.cn/'

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
    || loginConfig.value.dingtalkClientId
  )
}

function normalizeOidcDisplayName(value: unknown) {
  const displayName = String(value || '').trim()
  if (!displayName) return DEFAULT_OIDC_DISPLAY_NAME
  return Array.from(displayName).length <= MAX_OIDC_DISPLAY_NAME_LENGTH
    ? displayName
    : DEFAULT_OIDC_DISPLAY_NAME
}

async function loadLoginConfig() {
  if (loadingLoginConfig.value) {
    return
  }

  loadingLoginConfig.value = true
  try {
    const dynamicLoginConfig = await $fetch<{
      code: number
      data?: {
        mode?: string
        enabledProviders?: string[]
        ssoOidcEnable?: boolean
        oidcDisplayName?: string
        casEnable?: boolean
        wecomCorpid?: string
        wecomAgentid?: string
        dingtalkClientId?: string
      }
    }>(resolveCurrentAppUrl('/api/auth/login-config')).catch(() => null)

    if (dynamicLoginConfig?.data) {
      loginConfig.value = {
        mode: String(dynamicLoginConfig.data.mode || 'none'),
        enabledProviders: Array.isArray(dynamicLoginConfig.data.enabledProviders)
          ? dynamicLoginConfig.data.enabledProviders.map(item => String(item))
          : [],
        ssoOidcEnable: Boolean(dynamicLoginConfig.data.ssoOidcEnable),
        oidcDisplayName: normalizeOidcDisplayName(dynamicLoginConfig.data.oidcDisplayName),
        casEnable: Boolean(dynamicLoginConfig.data.casEnable),
        wecomCorpid: String(dynamicLoginConfig.data.wecomCorpid || ''),
        wecomAgentid: String(dynamicLoginConfig.data.wecomAgentid || ''),
        dingtalkClientId: String(dynamicLoginConfig.data.dingtalkClientId || '')
      }
    }
  } finally {
    loadingLoginConfig.value = false
  }
}

const loginProviderDefinitions: Record<LoginProvider, { label: string, icon: string }> = {
  oidc: { label: DEFAULT_OIDC_DISPLAY_NAME, icon: 'i-lucide-shield-check' },
  wecom: { label: '企业微信登录', icon: 'i-simple-icons-wechat' },
  dingtalk: { label: '钉钉登录', icon: 'i-lucide-message-circle' },
  cas: { label: 'CAS 登录', icon: 'i-lucide-building-2' }
}

function providerLabel(provider: LoginProvider) {
  return provider === 'oidc'
    ? loginConfig.value.oidcDisplayName
    : loginProviderDefinitions[provider].label
}

const availableProviders = computed<LoginProvider[]>(() => {
  const providers: LoginProvider[] = []
  if (loginConfig.value.ssoOidcEnable) providers.push('oidc')
  if (loginConfig.value.wecomCorpid && loginConfig.value.wecomAgentid) providers.push('wecom')
  if (loginConfig.value.dingtalkClientId) providers.push('dingtalk')
  if (loginConfig.value.casEnable) providers.push('cas')
  return providers.sort((left, right) => {
    if (left === loginConfig.value.mode) return -1
    if (right === loginConfig.value.mode) return 1
    return 0
  })
})

function providerButtonColor(provider: LoginProvider) {
  return loginConfig.value.mode === provider ? 'primary' as const : 'neutral' as const
}

function providerButtonVariant(provider: LoginProvider) {
  return loginConfig.value.mode === provider ? 'solid' as const : 'outline' as const
}

function providerIconClass(provider: LoginProvider) {
  if (loginConfig.value.mode === provider) return 'text-white'
  if (provider === 'wecom') return 'text-[#07c160]'
  if (provider === 'dingtalk') return 'text-[#1677ff]'
  return 'text-[#3a4656]'
}

async function startProviderLogin(provider: LoginProvider) {
  loginError.value = ''
  if (!hasLoginMethod()) {
    await loadLoginConfig()
  }

  if (!availableProviders.value.includes(provider)) {
    loginError.value = `${providerLabel(provider)}当前未启用。`
    return
  }

  const forceIdpLogin = loggedOut.value || route.query.prompt === 'login'
  const authQuery = new URLSearchParams({
    target_app: String(config.public.appCode || 'console'),
    redirect: resolveRedirectUrl(),
    force: '1'
  })
  if (forceIdpLogin) {
    authQuery.set('prompt', 'login')
  }
  const endpoint: Record<LoginProvider, string> = {
    oidc: '/api/auth/oidc-login',
    wecom: '/api/auth/wecom-login',
    dingtalk: '/api/auth/dingtalk-login',
    cas: '/api/auth/cas-login'
  }
  redirectingProvider.value = provider
  redirecting.value = true
  window.location.assign(resolveCurrentAppUrl(`${endpoint[provider]}?${authQuery.toString()}`))
}

async function startLocalLogin() {
  loginError.value = ''
  if (!hasLoginMethod()) await loadLoginConfig()

  const isWeWork = /wxwork/i.test(navigator.userAgent)
  if (isWeWork && availableProviders.value.includes('wecom')) {
    await startProviderLogin('wecom')
    return
  }

  if (availableProviders.value.length === 1) {
    await startProviderLogin(availableProviders.value[0]!)
    return
  }

  if (!availableProviders.value.length) {
    loginError.value = '当前入口未配置 Console 登录方式。请通过企业专属域名访问，或在 Platform 部署管理中配置 Console 登录入口并重新生成 policy bundle。'
  }
}

async function restartLogin() {
  logoutMarker.value = null
  const query = typeof route.query.redirect === 'string' && route.query.redirect.trim()
    ? { redirect: route.query.redirect.trim(), prompt: 'login' }
    : { prompt: 'login' }
  await navigateTo({ path: '/login', query }, { replace: true })
  await startLocalLogin()
}

const statusText = computed(() => {
  if (loggedOut.value) return '您已安全退出'
  if (loginError.value) return '无法跳转登录'
  if (redirecting.value) return '正在跳转登录...'
  if (loadingLoginConfig.value) return '正在加载登录方式...'
  if (availableProviders.value.length > 1) return '选择登录方式'
  return '正在跳转登录...'
})

const isBusy = computed(() => !loggedOut.value && !loginError.value && (loadingLoginConfig.value || redirecting.value))
const showProviderChoices = computed(() => !loadingLoginConfig.value && !loggedOut.value && availableProviders.value.length > 1)

onMounted(async () => {
  if (loggedOut.value) {
    return
  }

  await loadLoginConfig()

  const current = await $fetch<{
    code: number
    data?: {
      authenticated?: boolean
    }
  }>(resolveCurrentAppUrl('/api/v1/console/auth/me')).catch(() => null)

  if (current?.data?.authenticated && route.query.prompt !== 'login') {
    if (redirectTarget.value.startsWith('http://') || redirectTarget.value.startsWith('https://')) {
      window.location.replace(redirectTarget.value)
      return
    }
    await navigateTo(redirectTarget.value, { replace: true })
    return
  }

  await startLocalLogin()
})
</script>

<template>
  <main
    class="auth-screen"
    :class="{ 'auth-screen--logout': loggedOut }"
    :aria-busy="isBusy"
  >
    <img
      :src="productLogo"
      alt=""
      aria-hidden="true"
      class="auth-watermark auth-watermark--left"
    >
    <img
      :src="productLogo"
      alt=""
      aria-hidden="true"
      class="auth-watermark auth-watermark--right"
    >

    <section
      v-if="loggedOut"
      class="auth-card auth-card--logout"
      aria-labelledby="logout-title"
    >
      <div class="logout-success-mark">
        <UIcon
          name="i-lucide-check"
          class="size-9"
        />
      </div>
      <h1
        id="logout-title"
        class="logout-title"
      >
        您已安全退出
      </h1>
      <p class="logout-description">
        感谢使用汇智云数智协同平台<br>
        会话已结束,请妥善保管您的账号信息
      </p>
      <div class="auth-actions auth-actions--logout">
        <UButton
          block
          size="xl"
          color="primary"
          icon="i-lucide-log-in"
          :ui="{ leadingIcon: 'logout-login-icon' }"
          class="auth-action auth-action--primary"
          @click="restartLogin"
        >
          重新登录
        </UButton>
        <UButton
          block
          size="xl"
          color="neutral"
          variant="outline"
          :to="officialSiteUrl"
          external
          class="auth-action auth-action--secondary"
        >
          返回官网首页
        </UButton>
      </div>
      <div class="logout-brand">
        <img
          :src="productLogo"
          alt=""
          class="logout-brand__logo"
        >
        <span>汇智云数智协同平台</span>
      </div>
    </section>

    <section
      v-else
      class="auth-card auth-card--login"
      aria-labelledby="login-title"
    >
      <header class="login-heading">
        <img
          :src="productLogo"
          alt="汇智云"
          class="login-logo"
        >
        <h1
          id="login-title"
          class="login-title"
        >
          汇智云数智协同平台
        </h1>
        <p
          class="login-subtitle"
          aria-live="polite"
        >
          {{ statusText }}
        </p>
      </header>

      <div
        v-if="showProviderChoices"
        class="auth-actions auth-actions--providers"
      >
        <UButton
          v-for="provider in availableProviders"
          :key="provider"
          block
          size="xl"
          :icon="loginProviderDefinitions[provider].icon"
          :color="providerButtonColor(provider)"
          :variant="providerButtonVariant(provider)"
          :loading="redirectingProvider === provider"
          :disabled="!acceptedTerms || redirecting"
          :ui="{ leadingIcon: providerIconClass(provider) }"
          :class="[
            'auth-action',
            loginConfig.mode === provider ? 'auth-action--primary' : 'auth-action--secondary'
          ]"
          @click="startProviderLogin(provider)"
        >
          {{ providerLabel(provider) }}
        </UButton>
      </div>

      <div
        v-else-if="isBusy"
        class="auth-progress"
        aria-hidden="true"
      >
        <UIcon
          name="i-lucide-loader-circle"
          class="size-7 animate-spin text-primary"
        />
      </div>

      <p
        v-if="loginError"
        class="login-message login-message--error"
      >
        {{ loginError }}
      </p>
      <p
        v-if="!loginError && !loadingLoginConfig && !hasLoginMethod()"
        class="login-message"
      >
        当前未配置 Console 登录方式。
      </p>

      <div
        v-if="showProviderChoices"
        class="login-agreement"
      >
        <UCheckbox
          v-model="acceptedTerms"
          aria-label="同意用户协议与隐私政策"
          size="md"
          :ui="{ base: 'rounded-[4px]' }"
        />
        <p>
          我已阅读并同意
          <button
            type="button"
            class="agreement-link"
          >
            《用户协议》
          </button>
          与
          <button
            type="button"
            class="agreement-link"
          >
            《隐私政策》
          </button>
        </p>
      </div>
    </section>

    <footer
      class="auth-footer"
      :class="{ 'auth-footer--logout': loggedOut }"
    >
      © 2026 汇智科技
    </footer>
  </main>
</template>

<style scoped>
.auth-screen {
  position: relative;
  display: flex;
  min-height: 100dvh;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 48px 24px;
  background:
    radial-gradient(circle at calc(100% + 80px) -100px, rgb(41 182 246 / 18%), transparent 360px),
    radial-gradient(circle at -80px calc(100% + 100px), rgb(245 124 0 / 10%), transparent 390px),
    linear-gradient(160deg, #f7f8fa 0%, #eef1f5 55%, #e9f4fb 100%);
  color: #1f2733;
  font-family: "PingFang SC", "Microsoft YaHei", "Helvetica Neue", sans-serif;
}

.auth-watermark {
  position: absolute;
  pointer-events: none;
  user-select: none;
  animation: auth-float 6s ease-in-out infinite;
}

.auth-watermark--left {
  top: 13.3%;
  left: 11.1%;
  width: 120px;
  height: 120px;
  opacity: 0.1;
}

.auth-watermark--right {
  right: 12.5%;
  bottom: 15.5%;
  width: 80px;
  height: 80px;
  opacity: 0.08;
  animation-duration: 7s;
}

.auth-card {
  position: relative;
  z-index: 1;
  box-sizing: border-box;
  width: min(100%, 528px);
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 16px 48px rgb(31 39 51 / 10%), 0 2px 8px rgb(31 39 51 / 6%);
}

.auth-card--login {
  padding: 48px 44px 36px;
}

.auth-card--logout {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 52px 44px 40px;
}

.login-heading {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.login-logo {
  width: 64px;
  height: 64px;
  object-fit: contain;
}

.login-title,
.logout-title {
  margin: 14px 0 0;
  color: #1f2733;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: 1px;
  line-height: 1.4;
}

.login-subtitle {
  min-height: 20px;
  margin: 14px 0 0;
  color: #8a94a3;
  font-size: 14px;
  line-height: 20px;
}

.auth-actions {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 14px;
}

.auth-actions--providers {
  margin-top: 32px;
}

.auth-actions--logout {
  margin-top: 32px;
}

:deep(.auth-action) {
  height: 52px;
  border-radius: 10px;
  font-size: 16px;
  line-height: 1;
}

:deep(.auth-action--primary) {
  border: 0;
  background: linear-gradient(180deg, #fb8c00, #f57c00);
  box-shadow: 0 6px 16px rgb(245 124 0 / 28%);
  color: #fff;
  font-weight: 600;
}

:deep(.auth-action--primary:hover:not(:disabled)) {
  background: linear-gradient(180deg, #f9981e, #e97300);
}

:deep(.auth-action--secondary) {
  border: 1px solid #e5e9ee;
  background: #f4f6f8;
  color: #3a4656;
  font-weight: 500;
  box-shadow: none;
}

:deep(.auth-action--secondary:hover:not(:disabled)) {
  border-color: #d8dee6;
  background: #eef1f4;
}

.auth-progress {
  display: flex;
  min-height: 84px;
  align-items: center;
  justify-content: center;
  margin-top: 24px;
}

.login-message {
  margin: 24px 0 0;
  color: #8a94a3;
  font-size: 13px;
  line-height: 1.7;
  text-align: center;
}

.login-message--error {
  color: var(--ui-error);
}

.login-agreement {
  display: flex;
  width: 100%;
  align-items: flex-start;
  gap: 8px;
  margin-top: 26px;
  color: #8a94a3;
  font-size: 13px;
  line-height: 1.6;
}

.login-agreement p {
  margin: -1px 0 0;
}

.agreement-link {
  margin: 0;
  padding: 0;
  border: 0;
  color: #f57c00;
  cursor: pointer;
  font: inherit;
}

.agreement-link:hover {
  color: #e65100;
}

.logout-success-mark {
  display: flex;
  width: 72px;
  height: 72px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: radial-gradient(circle at 35% 30%, #e7f6ec, #d3efdc);
  color: #2e9e5b;
}

.logout-title {
  margin-top: 22px;
  letter-spacing: 0;
}

.logout-description {
  margin: 10px 0 0;
  color: #8a94a3;
  font-size: 14px;
  line-height: 1.7;
  text-align: center;
}

.logout-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 28px;
  color: #a7b0bc;
  font-size: 13px;
}

.logout-brand__logo {
  width: 20px;
  height: 20px;
  object-fit: contain;
}

.auth-footer {
  position: absolute;
  right: 0;
  bottom: 28px;
  left: 0;
  color: #a7b0bc;
  font-size: 13px;
  line-height: 20px;
  text-align: center;
}

@keyframes auth-float {
  0%,
  100% {
    transform: translateY(0);
  }

  50% {
    transform: translateY(-10px);
  }
}

@media (max-width: 639px) {
  .auth-screen {
    align-items: flex-start;
    padding: 0 28px 80px;
    background:
      linear-gradient(170deg, #f7f8fa 0%, #eef1f5 60%, #e9f4fb 100%);
  }

  .auth-watermark {
    display: none;
  }

  .auth-card {
    width: 100%;
    border-radius: 0;
    background: transparent;
    box-shadow: none;
  }

  .auth-card--login {
    padding: 96px 0 0;
  }

  .auth-card--logout {
    padding: 160px 0 0;
  }

  .login-logo {
    width: 72px;
    height: 72px;
  }

  .login-title,
  .logout-title {
    font-size: 21px;
  }

  .login-title {
    margin-top: 14px;
    white-space: nowrap;
  }

  .login-subtitle {
    margin-top: 8px;
  }

  .auth-actions--providers {
    margin-top: 48px;
  }

  :deep(.auth-action) {
    border-radius: 12px;
  }

  :deep(.auth-action--secondary) {
    background: #fff;
  }

  :deep(.logout-login-icon) {
    display: none;
  }

  .logout-success-mark {
    width: 80px;
    height: 80px;
  }

  .logout-title {
    margin-top: 24px;
  }

  .auth-actions--logout {
    margin-top: 44px;
  }

  .logout-brand {
    position: fixed;
    right: 0;
    bottom: 32px;
    left: 0;
    justify-content: center;
    margin: 0;
    font-size: 12px;
  }

  .logout-brand__logo {
    width: 18px;
    height: 18px;
  }

  .auth-footer {
    bottom: 32px;
    font-size: 12px;
  }

  .auth-footer--logout {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .auth-watermark {
    animation: none;
  }
}
</style>
