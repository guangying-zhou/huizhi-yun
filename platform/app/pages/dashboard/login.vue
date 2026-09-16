<script setup lang="ts">
definePageMeta({
  layout: 'public'
})

usePageTitle('企业管理员登录')

const route = useRoute()
const auth = useAuth()
const emailPending = ref(false)
const resendPending = ref(false)
const errorMessage = ref('')
const infoMessage = ref('')
const form = reactive({
  email: '',
  password: ''
})

const redirectTarget = computed(() => normalizeRedirect(route.query.redirect))

function normalizeRedirect(value: unknown) {
  const redirect = String(Array.isArray(value) ? value[0] : value || '').trim()
  if (!redirect || !redirect.startsWith('/dashboard') || redirect.startsWith('//')) {
    return '/dashboard'
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

async function handleEmailLogin() {
  emailPending.value = true
  errorMessage.value = ''
  infoMessage.value = ''

  try {
    const result = await auth.loginWithEmail({
      email: form.email,
      password: form.password,
      redirect: redirectTarget.value
    })

    await navigateTo(result.redirect || redirectTarget.value, { replace: true })
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    emailPending.value = false
  }
}

async function handleResendActivation() {
  if (!form.email.trim()) {
    errorMessage.value = '请输入需要激活的邮箱'
    return
  }

  resendPending.value = true
  errorMessage.value = ''
  infoMessage.value = ''

  try {
    await auth.resendActivationEmail({
      email: form.email,
      redirect: redirectTarget.value
    })
    infoMessage.value = '激活邮件已重新发送，请查收邮箱。'
  } catch (error) {
    errorMessage.value = getErrorMessage(error)
  } finally {
    resendPending.value = false
  }
}

onMounted(async () => {
  const state = await auth.loadMe({ scope: 'dashboard' })
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
          name="i-lucide-building-2"
          class="size-4"
        />
        企业工作台
      </div>
      <div class="space-y-3">
        <h1 class="text-3xl font-semibold leading-tight text-highlighted md:text-4xl">
          企业管理员登录
        </h1>
        <p class="text-base leading-7 text-muted">
          企业工作台面向租户管理员，用于管理自己企业的应用、成员、角色和授权。
        </p>
      </div>
      <div class="grid gap-3 text-sm text-muted sm:grid-cols-2">
        <div class="rounded-lg border border-default bg-muted p-3">
          <p class="font-medium text-highlighted">
            企业入口
          </p>
          <p class="mt-1">
            使用企业管理员账号进入工作台。
          </p>
        </div>
        <div class="rounded-lg border border-default bg-muted p-3">
          <p class="font-medium text-highlighted">
            企业归属
          </p>
          <p class="mt-1">
            进入企业前需要具备对应企业权限。
          </p>
        </div>
      </div>
    </div>

    <UCard class="w-full">
      <template #header>
        <h2 class="text-lg font-semibold text-highlighted">
          邮箱密码登录
        </h2>
      </template>

      <form
        class="space-y-5"
        @submit.prevent="handleEmailLogin"
      >
        <UFormField label="邮箱">
          <UInput
            v-model="form.email"
            type="email"
            autocomplete="email"
            icon="i-lucide-mail"
            class="w-full"
            placeholder="admin@example.com"
            size="lg"
          />
        </UFormField>

        <UFormField label="密码">
          <UInput
            v-model="form.password"
            type="password"
            autocomplete="current-password"
            icon="i-lucide-lock"
            class="w-full"
            placeholder="输入密码"
            size="lg"
          />
        </UFormField>

        <UAlert
          v-if="errorMessage"
          color="error"
          variant="soft"
          icon="i-lucide-circle-alert"
          :title="errorMessage"
        />

        <UAlert
          v-if="infoMessage"
          color="success"
          variant="soft"
          icon="i-lucide-circle-check"
          :title="infoMessage"
        />

        <UButton
          block
          size="lg"
          color="primary"
          icon="i-lucide-log-in"
          type="submit"
          :loading="emailPending"
        >
          登录企业工作台
        </UButton>

        <div class="flex items-center justify-between gap-3 text-sm">
          <UButton
            color="neutral"
            variant="link"
            to="/dashboard/register"
            class="px-0"
          >
            注册新账号
          </UButton>
          <UButton
            color="neutral"
            variant="link"
            class="px-0"
            :loading="resendPending"
            @click="handleResendActivation"
          >
            重发激活邮件
          </UButton>
        </div>

        <UButton
          block
          color="neutral"
          variant="soft"
          to="/admin/login"
        >
          前往平台员工登录
        </UButton>
      </form>
    </UCard>
  </section>
</template>
