<!--
  简化的 Account Store 测试页面
  访问路径: /account-test
-->
<script setup lang="ts">
import { useAccountStore } from '~/stores/account'

interface ConfigCheck {
  valid: boolean
  issues?: string[]
  warnings?: string[]
  recommendations?: string[]
  config?: {
    apiBaseUrl?: string
  }
}

const accountStore = useAccountStore()
const loading = ref(false)
const error = ref<string | null>(null)
const configCheck = ref<ConfigCheck | null>(null)

// 检查 API 配置
const checkConfig = async () => {
  try {
    configCheck.value = await $fetch<ConfigCheck>('/api/account/config-check')
  } catch (e) {
    console.error('Failed to check config:', e)
    configCheck.value = {
      valid: false,
      issues: ['无法检查配置'],
      warnings: []
    }
  }
}

interface UserListResponse {
  items?: Array<{ uid: string, realName: string, email: string, deptName?: string }>
}

interface DepartmentListResponse {
  flat?: Array<{ deptCode: string, name: string }>
  tree?: Array<{ deptCode: string, name: string, children?: Array<{ deptCode: string, name: string }> }>
}

// 测试数据
const testResults = ref({
  users: null as UserListResponse | null,
  departments: null as DepartmentListResponse | null,
  usersError: null as string | null,
  departmentsError: null as string | null
})

// 加载用户数据
const loadUsers = async () => {
  testResults.value.usersError = null
  loading.value = true

  try {
    const data = await accountStore.fetchUsers()
    testResults.value.users = data
  } catch (err: unknown) {
    const e = err as { message?: string }
    testResults.value.usersError = e.message || '获取用户列表失败'
    console.error('Failed to load users:', e)
  } finally {
    loading.value = false
  }
}

// 加载部门数据
const loadDepartments = async () => {
  testResults.value.departmentsError = null
  loading.value = true

  try {
    const data = await accountStore.fetchDepartments()
    testResults.value.departments = data
  } catch (err: unknown) {
    const e = err as { message?: string }
    testResults.value.departmentsError = e.message || '获取部门列表失败'
    console.error('Failed to load departments:', e)
  } finally {
    loading.value = false
  }
}

// 直接测试 API
const testApi = async () => {
  error.value = null
  loading.value = true

  try {
    const response = await $fetch('/api/account/users')
    console.log('API Response:', response)
    alert('API 测试成功！查看控制台输出')
  } catch (err: unknown) {
    const e = err as { message?: string }
    error.value = e.message || 'API 调用失败'
    console.error('API test failed:', e)
  } finally {
    loading.value = false
  }
}

// 页面加载时检查配置
onMounted(async () => {
  await checkConfig()
})
</script>

<template>
  <div class="account-test-page">
    <div class="container mx-auto p-6 max-w-4xl pb-20">
      <h1 class="text-3xl font-bold mb-6">
        Account Store 测试页面
      </h1>

      <!-- API 配置检查 -->
      <UCard
        v-if="configCheck"
        class="mb-6"
        :class="configCheck.valid && !configCheck.warnings?.length ? 'border-green-500' : 'border-red-500'"
      >
        <template #header>
          <div class="flex items-center gap-2">
            <UIcon
              :name="configCheck.valid && !configCheck.warnings?.length ? 'i-lucide-check-circle' : 'i-lucide-alert-circle'"
              :class="configCheck.valid && !configCheck.warnings?.length ? 'text-green-500' : 'text-red-500'"
            />
            <h2 class="text-xl font-semibold">
              API 配置状态
            </h2>
          </div>
        </template>

        <div v-if="!configCheck.valid || configCheck.issues?.length" class="text-red-600 mb-4">
          <p class="font-semibold mb-2">
            ❌ 配置错误
          </p>
          <ul class="list-disc list-inside space-y-1 mb-3">
            <li v-for="issue in configCheck.issues" :key="issue">
              {{ issue }}
            </li>
          </ul>
        </div>

        <div v-if="configCheck.warnings?.length" class="text-amber-600 mb-4">
          <p class="font-semibold mb-2">
            ⚠️ 配置警告
          </p>
          <ul class="list-disc list-inside space-y-1">
            <li v-for="warning in configCheck.warnings" :key="warning">
              {{ warning }}
            </li>
          </ul>
        </div>

        <div v-if="configCheck.valid && !configCheck.warnings?.length" class="text-green-600 mb-4">
          <p class="font-semibold">
            ✅ API 配置正常
          </p>
          <p class="text-sm mt-1">
            API URL: {{ configCheck.config?.apiBaseUrl }}
          </p>
        </div>

        <div v-if="configCheck.recommendations?.length" class="bg-gray-100 p-3 rounded text-sm">
          <p class="font-semibold mb-2">
            {{ configCheck.valid ? '✅ 推荐' : '💡 解决方法' }}：
          </p>
          <ol class="list-decimal list-inside space-y-1">
            <li v-for="rec in configCheck.recommendations" :key="rec">
              {{ rec }}
            </li>
          </ol>
        </div>

        <div class="mt-4">
          <UButton size="sm" variant="outline" @click="checkConfig">
            <UIcon name="i-lucide-refresh-cw" class="mr-2" />
            重新检查
          </UButton>
        </div>
      </UCard>

      <div v-else class="mb-6 text-center">
        <UIcon name="i-lucide-loader-2" class="animate-spin text-2xl" />
        <p class="mt-2 text-gray-500">
          正在检查配置...
        </p>
      </div>

      <!-- 操作按钮 -->
      <div class="flex gap-4 mb-6">
        <UButton
          :loading="loading"
          :disabled="!configCheck?.valid"
          icon="i-lucide-play"
          @click="testApi"
        >
          测试 API 连接
        </UButton>

        <UButton
          :loading="loading"
          :disabled="!configCheck?.valid"
          color="info"
          icon="i-lucide-users"
          @click="loadUsers"
        >
          加载用户列表
        </UButton>

        <UButton
          :loading="loading"
          :disabled="!configCheck?.valid"
          color="success"
          icon="i-lucide-building"
          @click="loadDepartments"
        >
          加载部门列表
        </UButton>
      </div>

      <!-- 错误提示 -->
      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        class="mb-6"
        title="错误"
        :description="error"
        :close-button="{ icon: 'i-lucide-x', color: 'error', variant: 'link' }"
        @close="error = null"
      />

      <!-- 用户列表结果 -->
      <UCard v-if="testResults.users || testResults.usersError" class="mb-6">
        <template #header>
          <h2 class="text-xl font-semibold">
            用户列表结果
          </h2>
        </template>

        <div v-if="testResults.usersError" class="text-red-600">
          ❌ {{ testResults.usersError }}
        </div>

        <div v-else-if="testResults.users">
          <p class="mb-3">
            ✅ 成功获取 {{ testResults.users.items?.length || 0 }} 个用户
          </p>

          <div v-if="testResults.users.items?.length" class="space-y-2">
            <div v-for="user in testResults.users.items.slice(0, 5)" :key="user.uid" class="p-3 border rounded">
              <div class="font-semibold">
                {{ user.realName }}
              </div>
              <div class="text-sm text-gray-600">
                @{{ user.uid }} · {{ user.email }}
              </div>
              <div class="text-sm text-gray-500">
                部门: {{ user.deptName || '未分配' }}
              </div>
            </div>

            <p v-if="testResults.users.items.length > 5" class="text-sm text-gray-500">
              ... 还有 {{ testResults.users.items.length - 5 }} 个用户
            </p>
          </div>
        </div>
      </UCard>

      <!-- 部门列表结果 -->
      <UCard v-if="testResults.departments || testResults.departmentsError" class="mb-6">
        <template #header>
          <h2 class="text-xl font-semibold">
            部门列表结果
          </h2>
        </template>

        <div v-if="testResults.departmentsError" class="text-red-600">
          ❌ {{ testResults.departmentsError }}
        </div>

        <div v-else-if="testResults.departments">
          <p class="mb-3">
            ✅ 成功获取 {{ testResults.departments.flat?.length || 0 }} 个部门
          </p>

          <div v-if="testResults.departments.tree?.length" class="space-y-2">
            <div v-for="dept in testResults.departments.tree" :key="dept.deptCode" class="p-3 border rounded">
              <div class="font-semibold">
                {{ dept.name }}
              </div>
              <div class="text-sm text-gray-600">
                ID: {{ dept.deptCode }}
              </div>

              <div v-if="dept.children?.length" class="ml-4 mt-2 space-y-1">
                <div v-for="child in dept.children" :key="child.deptCode" class="text-sm p-2 bg-gray-50 rounded">
                  {{ child.name }} ({{ child.deptCode }})
                </div>
              </div>
            </div>
          </div>
        </div>
      </UCard>

      <!-- Store 状态 -->
      <UCard>
        <template #header>
          <h2 class="text-xl font-semibold">
            Store 缓存状态
          </h2>
        </template>

        <div class="space-y-2">
          <div class="flex justify-between">
            <span>缓存用户数:</span>
            <span class="font-semibold">{{ accountStore.allUsers.length }}</span>
          </div>
          <div class="flex justify-between">
            <span>缓存部门数:</span>
            <span class="font-semibold">{{ accountStore.departmentFlat.length }}</span>
          </div>
          <div class="flex justify-between">
            <span>缓存项目数:</span>
            <span class="font-semibold">{{ accountStore.allProjects.length }}</span>
          </div>

          <UButton
            color="error"
            variant="soft"
            class="mt-4"
            block
            @click="accountStore.clearAllCache(); testResults = { users: null, departments: null, usersError: null, departmentsError: null }"
          >
            清除所有缓存
          </UButton>
        </div>
      </UCard>

      <!-- 帮助信息 -->
      <UCard class="mt-6">
        <template #header>
          <h2 class="text-xl font-semibold">
            使用说明
          </h2>
        </template>

        <div class="prose prose-sm">
          <ol>
            <li>首先检查 API 配置状态是否正常</li>
            <li>点击"测试 API 连接"按钮测试基本连接</li>
            <li>点击其他按钮测试具体功能</li>
            <li>查看浏览器控制台查看详细日志</li>
          </ol>

          <p class="mt-4">
            <strong>配置文档:</strong>
            <a href="/docs/account-api-config.md" target="_blank" class="text-blue-600">
              docs/account-api-config.md
            </a>
          </p>
        </div>
      </UCard>
    </div>
  </div>
</template>

<style scoped>
.account-test-page {
  min-height: 100vh;
  height: auto;
  overflow-y: auto;
  overflow-x: hidden;
}
</style>
