# 迁移到 Pinia Store 指南

## 概述

本指南说明如何将现有代码从直接调用 API 迁移到使用 Pinia Store。

## 已完成的迁移

### 1. UserTreeSelect 组件 ✅

**文件**: `app/components/document/UserTreeSelect.vue`

**修改前**:
```vue
<script setup>
const allUsers = ref<User[]>([])

const fetchUsers = async () => {
  const response = await $fetch('/api/users/tree')
  allUsers.value = response.items || []
}
</script>
```

**修改后**:
```vue
<script setup>
import { useAccountStore } from '~/stores/account'

const accountStore = useAccountStore()
const allUsers = computed(() => accountStore.allUsers)

const fetchUsers = async () => {
  await accountStore.fetchUsers()
}
</script>
```

**优势**:
- ✅ 自动缓存管理
- ✅ 数据共享（多个组件使用同一份数据）
- ✅ 统一的错误处理
- ✅ 支持强制刷新

## 可用的 Composables

### 基础 Composables (app/composables/useAccount.ts)

#### 1. useAccountUser(uid)
获取单个用户信息
```vue
<script setup>
import { useAccountUser } from '~/composables/useAccount'

const uid = ref('zhangsan')
const { user, loading, error, reload } = useAccountUser(uid)
</script>
```

#### 2. useAccountUsers(uids)
批量获取用户信息
```vue
<script setup>
import { useAccountUsers } from '~/composables/useAccount'

const uids = ref(['zhangsan', 'lisi'])
const { users, loading, error } = useAccountUsers(uids)
</script>
```

#### 3. useAccountDepartments()
获取部门信息
```vue
<script setup>
import { useAccountDepartments } from '~/composables/useAccount'

const {
  departments,      // 树形结构
  departmentsFlat,  // 扁平列表
  loading,
  getDepartment
} = useAccountDepartments()
</script>
```

#### 4. useAccountProject(projectCode)
获取单个项目信息
```vue
<script setup>
import { useAccountProject } from '~/composables/useAccount'

const projectCode = ref('PROJECT001')
const { project, loading, error } = useAccountProject(projectCode)
</script>
```

#### 5. useAccountUserProjects(uid)
获取用户的项目
```vue
<script setup>
import { useAccountUserProjects } from '~/composables/useAccount'

const uid = ref('zhangsan')
const {
  managedProjects,  // 管理的项目
  joinedProjects,   // 参与的项目
  loading
} = useAccountUserProjects(uid)
</script>
```

#### 6. useAccountUserSearch()
用户搜索
```vue
<script setup>
import { useAccountUserSearch } from '~/composables/useAccount'

const {
  searchKeyword,
  deptCode,
  users,
  loading,
  search
} = useAccountUserSearch()

// 搜索会自动触发
searchKeyword.value = '张'
deptCode.value = 'RD'
</script>
```

### 简化 Composables (app/composables/useSelectors.ts)

#### 1. useUserSelector()
用户选择器
```vue
<script setup>
import { useUserSelector } from '~/composables/useSelectors'

const {
  users,                    // 所有用户
  loading,
  loadUsers,               // 加载用户
  getUserByUid,       // 获取单个用户
  getUsersByUids,     // 批量获取
  searchUsers             // 搜索
} = useUserSelector()

onMounted(() => {
  loadUsers()
})
</script>
```

#### 2. useDepartmentSelector()
部门选择器
```vue
<script setup>
import { useDepartmentSelector } from '~/composables/useSelectors'

const {
  departmentTree,         // 树形结构
  departmentFlat,         // 扁平列表
  loading,
  loadDepartments,        // 加载部门
  getDepartmentById      // 获取单个部门
} = useDepartmentSelector()
</script>
```

#### 3. useProjectSelector()
项目选择器
```vue
<script setup>
import { useProjectSelector } from '~/composables/useSelectors'

const {
  git_projects,              // 所有项目
  loading,
  loadProjects,          // 加载项目
  getProjectById,        // 获取单个项目
  loadUserProjects      // 获取用户项目
} = useProjectSelector()
</script>
```

## 迁移步骤

### 步骤 1: 识别需要迁移的代码

查找以下模式：
```javascript
// 直接 API 调用
$fetch('/api/users/...')
$fetch('/api/departments/...')
$fetch('/api/projects/...')
useFetch('/api/users/...')
```

### 步骤 2: 选择合适的方案

**简单场景** → 使用 Composables
```vue
<script setup>
import { useAccountUser } from '~/composables/useAccount'

const { user, loading } = useAccountUser('zhangsan')
</script>
```

**复杂场景** → 直接使用 Store
```vue
<script setup>
import { useAccountStore } from '~/stores/account'

const accountStore = useAccountStore()

// 自定义逻辑
const customFetch = async () => {
  await accountStore.fetchUsers({ dept_code: 'RD' })
  const users = accountStore.allUsers
  // ... 更多处理
}
</script>
```

### 步骤 3: 更新组件代码

#### 示例 1: 用户列表

**修改前**:
```vue
<script setup>
const users = ref([])
const loading = ref(false)

const fetchUsers = async () => {
  loading.value = true
  try {
    const res = await $fetch('/api/users/tree')
    users.value = res.items
  } finally {
    loading.value = false
  }
}

onMounted(() => fetchUsers())
</script>
```

**修改后**:
```vue
<script setup>
import { useUserSelector } from '~/composables/useSelectors'

const { users, loading, loadUsers } = useUserSelector()

onMounted(() => loadUsers())
</script>
```

#### 示例 2: 部门选择器

**修改前**:
```vue
<script setup>
const departments = ref([])

const fetchDepartments = async () => {
  const res = await $fetch('/api/departments')
  departments.value = res.data.flat
}
</script>
```

**修改后**:
```vue
<script setup>
import { useDepartmentSelector } from '~/composables/useSelectors'

const { departmentFlat, loadDepartments } = useDepartmentSelector()

onMounted(() => loadDepartments())
</script>
```

#### 示例 3: 项目列表

**修改前**:
```vue
<script setup>
const git_projects = ref([])

const fetchProjects = async () => {
  const res = await $fetch('/api/project', {
    query: { status: 1 }
  })
  git_projects.value = res.data.items
}
</script>
```

**修改后**:
```vue
<script setup>
import { useProjectSelector } from '~/composables/useSelectors'

const { git_projects, loadProjects } = useProjectSelector()

onMounted(() => loadProjects({ status: 1 }))
</script>
```

## 优势对比

### 使用 API 直接调用
```vue
❌ 每次都要写 loading 状态
❌ 每次都要写 error 处理
❌ 数据不共享，重复加载
❌ 没有缓存机制
❌ 代码重复
```

### 使用 Pinia Store
```vue
✅ 自动管理 loading 状态
✅ 统一的 error 处理
✅ 数据自动共享和缓存
✅ 支持强制刷新
✅ 代码简洁
✅ 类型安全
```

## 常见问题

### Q: 何时使用 Store，何时使用 Composable？

**使用 Composable（推荐）**:
- 简单的数据获取和显示
- 单个组件内使用
- 需要自动加载和响应式更新

**直接使用 Store**:
- 需要复杂的数据操作
- 需要手动控制加载时机
- 需要访问多个数据源

### Q: 数据会自动刷新吗？

不会。数据使用缓存机制：
- 首次调用时从 API 加载
- 后续调用使用缓存数据
- 可以传入 `force: true` 强制刷新

```typescript
await accountStore.fetchUsers({ force: true })
// 或
reload() // 在 composable 中
```

### Q: 如何清除缓存？

```typescript
// 清除特定缓存
accountStore.clearUserCache('zhangsan')
accountStore.clearDepartmentCache()
accountStore.clearProjectCache('PROJECT001')

// 清除所有缓存
accountStore.clearAllCache()
```

### Q: 原有的 API 端点还能用吗？

可以。但建议逐步迁移到使用 Store：
- `/api/users/tree` → 使用 `useUserSelector()`
- `/api/users/search` → 使用 `useAccountUserSearch()`
- `/api/departments` → 使用 `useDepartmentSelector()`
- `/api/project` → 使用 `useProjectSelector()`

## 需要迁移的潜在组件

以下组件可能需要检查和迁移：

### 页面
- `app/pages/admin/users.vue` - 用户管理（未实现）
- `app/pages/projects/index.vue` - 项目文档列表
- 其他可能使用用户/部门/项目信息的页面

### 组件
- ✅ `app/components/document/UserTreeSelect.vue` - 已迁移
- `app/components/document/ShareDocumentModal.vue` - 可能需要
- 其他需要用户选择的组件

## 测试验证

迁移后务必测试：
1. ✅ 数据能正常加载
2. ✅ Loading 状态正确显示
3. ✅ 错误能正确处理
4. ✅ 缓存机制工作正常
5. ✅ 多个组件共享数据

## 相关文档

- [Pinia Store 使用指南](./pinia-account-store.md)
- [代码示例](./account-store-examples.md)
- [测试环境配置](./test-env-quick-ref.md)

## 更新日期

2026-01-23
