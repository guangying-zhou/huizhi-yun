<script setup lang="ts">
import { ref } from 'vue'

usePageTitle('修改密码')

const toast = useToast()
const loading = ref(false)

const form = ref({
  oldPassword: '',
  newPassword: '',
  confirmPassword: ''
})

interface FormError {
  path: string
  message: string
}

const validate = (state: typeof form.value): FormError[] => {
  const errors: FormError[] = []
  if (!state.oldPassword) errors.push({ path: 'oldPassword', message: '请输入当前密码' })
  if (!state.newPassword) errors.push({ path: 'newPassword', message: '请输入新密码' })
  if (state.newPassword.length < 6) errors.push({ path: 'newPassword', message: '密码长度不能少于6位' })
  if (state.newPassword !== state.confirmPassword) errors.push({ path: 'confirmPassword', message: '两次输入的密码不一致' })
  return errors
}

async function onSubmit() {
  loading.value = true
  try {
    await $fetch('/api/user/password', {
      method: 'PUT',
      body: {
        oldPassword: form.value.oldPassword,
        newPassword: form.value.newPassword
      }
    })

    toast.add({ title: '密码修改成功', color: 'success' })
    form.value = { oldPassword: '', newPassword: '', confirmPassword: '' }
  } catch (err: unknown) {
    const error = err as { data?: { message?: string }, message?: string }
    toast.add({
      title: '修改失败',
      description: error.data?.message || error.message,
      color: 'error'
    })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <UDashboardPanel grow>
    <div class="p-4 max-w-2xl mx-auto w-full">
      <UCard>
        <template #header>
          <div class="text-base font-semibold">
            修改账号密码
          </div>
          <div class="text-sm text-gray-500 mt-1">
            建议使用包含字母、数字和符号的强密码
          </div>
        </template>

        <UForm
          :validate="validate"
          :state="form"
          class="space-y-4"
          @submit="onSubmit"
        >
          <UFormField label="当前密码" name="oldPassword" required>
            <UInput
              v-model="form.oldPassword"
              type="password"
              placeholder="请输入当前密码"
              autocomplete="current-password"
            />
          </UFormField>

          <UFormField label="新密码" name="newPassword" required>
            <UInput
              v-model="form.newPassword"
              type="password"
              placeholder="请输入新密码"
              autocomplete="new-password"
            />
          </UFormField>

          <UFormField label="确认新密码" name="confirmPassword" required>
            <UInput
              v-model="form.confirmPassword"
              type="password"
              placeholder="请再次输入新密码"
              autocomplete="new-password"
            />
          </UFormField>

          <div class="flex justify-end pt-4">
            <UButton type="submit" color="primary" :loading="loading">
              确认修改
            </UButton>
          </div>
        </UForm>
      </UCard>
    </div>
  </UDashboardPanel>
</template>
