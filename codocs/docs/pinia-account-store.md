# Pinia Account Store 使用指南

本项目已集成 `@pinia/nuxt`，用于统一管理从 Account 模块获取的部门、用户、项目信息等。

## 安装

依赖已安装：
- `@pinia/nuxt`: ^0.11.3
- `pinia`: ^3.0.4

## Store 结构

### Account Store (`app/stores/account.ts`)

提供以下功能：

#### State
- `users`: 用户信息缓存 (Map)
- `departments`: 部门信息（树形和扁平结构）
- `git_projects`: 项目信息缓存 (Map)
- `userProjects`: 用户项目映射 (Map)

#### Getters
- `allUsers`: 获取所有用户列表
- `getUserByUid(uid)`: 根据用户名获取用户
- `departmentTree`: 获取部门树形结构
- `departmentFlat`: 获取部门扁平列表
- `getDepartmentById(deptCode)`: 根据部门ID获取部门
- `allProjects`: 获取所有项目列表
- `getProjectById(projectCode)`: 根据项目ID获取项目
- `getUserProjects(uid)`: 获取用户的项目

#### Actions
- `fetchUsers(params)`: 获取用户列表
- `fetchUser(uid, force)`: 获取单个用户详情
- `fetchUsersBatch(uids)`: 批量获取用户
- `fetchDepartments(force)`: 获取部门列表
- `fetchProjects(params)`: 获取项目列表
- `fetchProject(projectCode, force)`: 获取单个项目详情
- `fetchUserProjects(uid, force)`: 获取用户的项目
- `clearUserCache(uid)`: 清除用户缓存
- `clearDepartmentCache()`: 清除部门缓存
- `clearProjectCache(projectCode)`: 清除项目缓存
- `clearAllCache()`: 清除所有缓存

## 使用示例

### 在 Vue 组件中使用

```vue
<script setup lang="ts">
import { useAccountStore } from '~/stores/account'

const accountStore = useAccountStore()

// 获取部门列表
onMounted(async () => {
  await accountStore.fetchDepartments()
})

// 使用 getter
const departments = computed(() => accountStore.departmentTree)
const users = computed(() => accountStore.allUsers)

// 获取用户信息
async function loadUser(uid: string) {
  await accountStore.fetchUser(uid)
  const user = accountStore.getUserByUid(uid)
  console.log(user)
}

// 批量获取用户
async function loadMultipleUsers() {
  const uids = ['zhangsan', 'lisi', 'wangwu']
  await accountStore.fetchUsersBatch(uids)

  uids.forEach(uid => {
    const user = accountStore.getUserByUid(uid)
    console.log(user)
  })
}

// 获取用户的项目
async function loadUserProjects(uid: string) {
  const git_projects = await accountStore.fetchUserProjects(uid)
  console.log('管理的项目:', git_projects?.managed)
  console.log('参与的项目:', git_projects?.joined)
}

// 搜索用户
async function searchUsers(keyword: string) {
  await accountStore.fetchUsers({ search: keyword })
}

// 按部门筛选用户
async function getUsersByDept(deptCode: string) {
  await accountStore.fetchUsers({ dept_code: deptCode })
}
</script>

<template>
  <div>
    <h2>部门列表</h2>
    <ul>
      <li v-for="dept in departments" :key="dept.deptCode">
        {{ dept.name }}
      </li>
    </ul>

    <h2>用户列表</h2>
    <ul>
      <li v-for="user in users" :key="user.uid">
        {{ user.realName }} ({{ user.uid }})
      </li>
    </ul>
  </div>
</template>
```

### 在 Composable 中使用

```typescript
// app/composables/useUserInfo.ts
import { useAccountStore } from '~/stores/account'

export function useUserInfo(uid: string) {
  const accountStore = useAccountStore()

  const user = computed(() => accountStore.getUserByUid(uid))
  const loading = ref(false)

  const load = async (force = false) => {
    loading.value = true
    try {
      await accountStore.fetchUser(uid, force)
    } finally {
      loading.value = false
    }
  }

  // 自动加载
  onMounted(() => {
    if (!user.value) {
      load()
    }
  })

  return {
    user,
    loading,
    reload: () => load(true)
  }
}
```

### 在页面中使用

```vue
<script setup lang="ts">
const accountStore = useAccountStore()

// 页面加载时获取数据
const { data: departments } = await useAsyncData(
  'departments',
  () => accountStore.fetchDepartments()
)

const { data: users } = await useAsyncData(
  'users',
  () => accountStore.fetchUsers()
)
</script>
```

### 在服务端中间件中使用

```typescript
// server/middleware/loadAccountData.ts
export default defineEventHandler(async (event) => {
  // 服务端不能直接使用 Pinia store
  // 需要通过 API 端点调用
})
```

## API 端点

项目提供了以下 API 端点，用于与 Account 系统交互：

- `GET /api/account/users` - 获取用户列表
- `GET /api/account/users/:uid` - 获取单个用户
- `POST /api/account/users/batch` - 批量获取用户
- `GET /api/account/users/:uid/project` - 获取用户的项目
- `GET /api/account/departments` - 获取部门列表
- `GET /api/account/project` - 获取项目列表
- `GET /api/account/projects/:projectCode` - 获取单个项目

## 类型定义

所有类型定义在 `app/types/account.ts` 中：

- `AccountUser`: 用户信息
- `Department`: 部门信息
- `Project`: 项目信息
- `UserProjects`: 用户项目（管理和参与）
- `ApiResponse<T>`: API 响应格式

## 缓存策略

Store 实现了智能缓存：

1. **用户信息**: 按 uid 缓存，支持单个获取和批量获取
2. **部门信息**: 全局缓存，默认不自动刷新
3. **项目信息**: 按 projectCode 缓存
4. **用户项目**: 按 uid 缓存

所有 fetch 方法都支持 `force` 参数来强制刷新缓存。

## 注意事项

1. Store 仅在客户端可用，服务端需要直接调用 API
2. 首次使用需要手动调用 fetch 方法加载数据
3. 数据会在内存中缓存，刷新页面后会清空
4. 支持强制刷新，传入 `force: true` 参数

## 环境配置

确保在 `.env.dev` 或相应环境变量中配置了 Account API：

```env
HZY_CONSOLE_API_URL=https://account.wiztek.cn
HZY_ACCOUNT_API_KEY=your_api_key
HZY_ACCOUNT_API_SECRET=your_api_secret
```
