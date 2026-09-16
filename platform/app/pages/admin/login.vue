<script setup lang="ts">
definePageMeta({
  layout: 'public'
})

usePageTitle('平台员工登录')

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const auth = useAuth()
const pending = ref(false)
const errorMessage = ref('')

const devMockEnabled = computed(() => Boolean(runtimeConfig.public.authDevMockEnabled))
const googleLoginEnabled = computed(() => Boolean(runtimeConfig.public.googleAdminLoginEnabled))
const wecomLoginEnabled = computed(() => Boolean(runtimeConfig.public.wecomAdminLoginEnabled))
const redirectTarget = computed(() => normalizeRedirect(route.query.redirect))
const wecomLoginUrl = computed(() => `/api/platform/auth/wecom/start?redirect=${encodeURIComponent(redirectTarget.value)}`)
const googleLoginUrl = computed(() => `/api/platform/auth/google/start?redirect=${encodeURIComponent(redirectTarget.value)}`)

function normalizeRedirect(value: unknown) {
  const redirect = String(Array.isArray(value) ? value[0] : value || '').trim()
  if (!redirect || !redirect.startsWith('/admin') || redirect.startsWith('//')) {
    return '/admin'
  }

  return redirect
}

function getErrorMessage(error: unknown) {
  if (error && typeof error === 'object') {
    const fetchError = error as {
      data?: { message?: string, statusMessage?: string }
      message?: string
    }

    return fetchError.data?.message
      || fetchError.data?.statusMessage
      || fetchError.message
      || '登录失败'
  }

  return '登录失败'
}

function firstQueryString(value: unknown) {
  return String(Array.isArray(value) ? value[0] : value || '').trim()
}

async function handleDevWechatLogin() {
  pending.value = true
  errorMessage.value = ''

  try {
    const result = await auth.loginWithDevWechat({
      redirect: redirectTarget.value
    })

    await navigateTo(result.redirect || redirectTarget.value, { replace: true })
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    pending.value = false
  }
}

onMounted(async () => {
  const providerError = firstQueryString(route.query.wecomError) || firstQueryString(route.query.googleError)
  if (providerError) {
    errorMessage.value = providerError
  }

  const state = await auth.loadMe({ scope: 'admin' })
  if (state.authenticated) {
    await navigateTo(redirectTarget.value, { replace: true })
  }
})
</script>

<template>
  <section class="mx-auto grid min-h-[calc(100vh-90px)] w-full max-w-6xl items-center gap-8 px-6 py-10 lg:grid-cols-[1fr_26rem] lg:px-10">
    <div class="max-w-2xl space-y-5">
      <div class="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-sm font-medium text-primary">
        <UIcon
          name="i-lucide-shield-check"
          class="size-4"
        />
        Admin Console
      </div>
      <div class="space-y-3">
        <h1 class="text-3xl font-semibold leading-tight text-slate-950 md:text-4xl">
          平台员工登录
        </h1>
        <p class="text-base leading-7 text-slate-600">
          Admin 仅面向汇智云平台员工，用于租户开通、应用治理、订阅部署和平台运营。
        </p>
      </div>
      <div class="grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
        <div class="rounded-lg border border-slate-200 bg-white/80 p-3">
          <p class="font-medium text-slate-900">
            员工入口
          </p>
          <p class="mt-1">
            使用平台员工身份进入运营后台。
          </p>
        </div>
        <div class="rounded-lg border border-slate-200 bg-white/80 p-3">
          <p class="font-medium text-slate-900">
            企业入口
          </p>
          <p class="mt-1">
            企业管理员请使用企业工作台入口。
          </p>
        </div>
      </div>
    </div>

    <UCard class="w-full">
      <template #header>
        <div class="space-y-1">
          <p class="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
            Staff
          </p>
          <h2 class="text-lg font-semibold text-slate-950">
            员工身份登录
          </h2>
        </div>
      </template>

      <div class="space-y-5">
        <UAlert
          v-if="errorMessage"
          color="error"
          variant="soft"
          icon="i-lucide-circle-alert"
          :title="errorMessage"
        />

        <UAlert
          v-if="!devMockEnabled && !wecomLoginEnabled && !googleLoginEnabled"
          color="warning"
          variant="soft"
          icon="i-lucide-circle-alert"
          title="当前环境未配置员工登录入口"
          description="请使用已配置的员工身份服务登录。"
        />

        <UButton
          v-if="wecomLoginEnabled"
          block
          size="lg"
          color="primary"
          icon="i-simple-icons-wechat"
          :to="wecomLoginUrl"
          external
        >
          使用企业微信登录
        </UButton>

        <UButton
          v-if="googleLoginEnabled"
          block
          size="lg"
          color="primary"
          icon="i-simple-icons-google"
          :to="googleLoginUrl"
          external
        >
          使用 Google 登录
        </UButton>

        <UButton
          v-if="devMockEnabled"
          block
          size="lg"
          color="primary"
          icon="i-lucide-message-circle"
          :loading="pending"
          @click="handleDevWechatLogin"
        >
          开发环境员工登录
        </UButton>

        <UButton
          block
          color="neutral"
          variant="soft"
          to="/dashboard/login"
        >
          前往企业管理员登录
        </UButton>
      </div>
    </UCard>
  </section>
</template>
