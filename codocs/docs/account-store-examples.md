# Account Store 快速使用示例

## 示例 1: 获取并显示用户信息

```vue
<script setup lang="ts">
import { useAccountUser } from '~/composables/useAccount'

const uid = ref('zhangsan')
const { user, loading, error } = useAccountUser(uid)
</script>

<template>
  <div v-if="loading">加载中...</div>
  <div v-else-if="error">错误: {{ error.message }}</div>
  <div v-else-if="user">
    <h2>{{ user.realName }}</h2>
    <p>用户名: {{ user.uid }}</p>
    <p>邮箱: {{ user.email }}</p>
    <p>部门: {{ user.deptName }}</p>
  </div>
</template>
```

## 示例 2: 部门选择器组件

```vue
<script setup lang="ts">
import { useAccountDepartments } from '~/composables/useAccount'

const { departments, loading } = useAccountDepartments()
const selectedDeptCode = defineModel<string>()
</script>

<template>
  <USelect
    v-model="selectedDeptCode"
    :options="departments"
    option-attribute="name"
    value-attribute="deptCode"
    placeholder="选择部门"
    :loading="loading"
  />
</template>
```

## 示例 3: 用户搜索组件

```vue
<script setup lang="ts">
import { useAccountUserSearch } from '~/composables/useAccount'

const { searchKeyword, users, loading } = useAccountUserSearch()
</script>

<template>
  <div>
    <UInput
      v-model="searchKeyword"
      placeholder="搜索用户..."
      icon="i-lucide-search"
    />

    <div v-if="loading">搜索中...</div>
    <div v-else>
      <div v-for="user in users" :key="user.uid">
        {{ user.realName }} - {{ user.email }}
      </div>
    </div>
  </div>
</template>
```

## 示例 4: 批量获取用户信息

```vue
<script setup lang="ts">
import { useAccountUsers } from '~/composables/useAccount'

const uids = ref(['zhangsan', 'lisi', 'wangwu'])
const { users, loading } = useAccountUsers(uids)
</script>

<template>
  <div v-if="loading">加载中...</div>
  <ul v-else>
    <li v-for="user in users" :key="user.uid">
      {{ user.realName }}
    </li>
  </ul>
</template>
```

## 示例 5: 获取用户项目

```vue
<script setup lang="ts">
import { useAccountUserProjects } from '~/composables/useAccount'

const uid = ref('zhangsan')
const { managedProjects, joinedProjects, loading } = useAccountUserProjects(uid)
</script>

<template>
  <div v-if="loading">加载中...</div>
  <div v-else>
    <h3>管理的项目</h3>
    <div v-for="project in managedProjects" :key="project.projectCode">
      {{ project.name }}
    </div>

    <h3>参与的项目</h3>
    <div v-for="project in joinedProjects" :key="project.projectCode">
      {{ project.name }} ({{ project.role }})
    </div>
  </div>
</template>
```

## 示例 6: 直接使用 Store (高级用法)

```vue
<script setup lang="ts">
import { useAccountStore } from '~/stores/account'

const accountStore = useAccountStore()

// 手动获取数据
const fetchData = async () => {
  await accountStore.fetchDepartments()
  await accountStore.fetchUsers({ dept_code: 'RD' })
}

// 使用 getter
const users = computed(() => accountStore.allUsers)
const departments = computed(() => accountStore.departmentTree)

// 获取特定用户
const getUser = (uid: string) => {
  return accountStore.getUserByUid(uid)
}

// 清除缓存
const clearCache = () => {
  accountStore.clearAllCache()
}

onMounted(() => {
  fetchData()
})
</script>

<template>
  <div>
    <button @click="clearCache">清除缓存</button>

    <h2>部门列表</h2>
    <div v-for="dept in departments" :key="dept.deptCode">
      {{ dept.name }}
    </div>

    <h2>用户列表</h2>
    <div v-for="user in users" :key="user.uid">
      {{ user.realName }}
    </div>
  </div>
</template>
```

## 示例 7: 组合使用多个数据源

```vue
<script setup lang="ts">
import { useAccountUser, useAccountDepartments, useAccountUserProjects } from '~/composables/useAccount'

const uid = ref('zhangsan')

// 获取用户信息
const { user, loading: userLoading } = useAccountUser(uid)

// 获取部门信息
const { getDepartment } = useAccountDepartments()

// 获取用户项目
const { managedProjects, loading: projectsLoading } = useAccountUserProjects(uid)

// 计算用户的部门详情
const userDepartment = computed(() => {
  return user.value?.deptCode ? getDepartment(user.value.deptCode) : null
})

const isLoading = computed(() => userLoading.value || projectsLoading.value)
</script>

<template>
  <div v-if="isLoading">加载中...</div>
  <div v-else-if="user">
    <h2>{{ user.realName }}</h2>
    <p>部门: {{ userDepartment?.name }}</p>
    <p>管理项目数: {{ managedProjects.length }}</p>
  </div>
</template>
```

## 示例 8: 服务端数据获取 (页面)

```vue
<script setup lang="ts">
// 在页面中使用 useAsyncData 进行服务端数据获取
const { data: users } = await useAsyncData('users', () =>
  $fetch('/api/account/users')
)

const { data: departments } = await useAsyncData('departments', () =>
  $fetch('/api/account/departments')
)
</script>

<template>
  <div>
    <h2>用户: {{ users?.data?.items?.length || 0 }}</h2>
    <h2>部门: {{ departments?.data?.flat?.length || 0 }}</h2>
  </div>
</template>
```

## 示例 9: 实时搜索用户

```vue
<script setup lang="ts">
import { useAccountStore } from '~/stores/account'

const accountStore = useAccountStore()
const searchQuery = ref('')
const selectedDept = ref<string>()

// 使用 watchDebounced 实现防抖搜索
watchDebounced(
  [searchQuery, selectedDept],
  async () => {
    await accountStore.fetchUsers({
      search: searchQuery.value || undefined,
      dept_code: selectedDept.value
    })
  },
  { debounce: 500 }
)

const users = computed(() => accountStore.allUsers)
</script>

<template>
  <div>
    <UInput v-model="searchQuery" placeholder="搜索..." />
    <USelect v-model="selectedDept" placeholder="选择部门" />

    <div v-for="user in users" :key="user.uid">
      {{ user.realName }}
    </div>
  </div>
</template>
```

## 示例 10: 用户选择器 (支持多选)

```vue
<script setup lang="ts">
import { useAccountStore } from '~/stores/account'

const accountStore = useAccountStore()
const selectedUids = defineModel<string[]>({ default: [] })

// 加载所有用户
onMounted(async () => {
  await accountStore.fetchUsers()
})

const users = computed(() => accountStore.allUsers)

// 获取已选用户信息
const selectedUsers = computed(() =>
  selectedUids.value
    .map(uid => accountStore.getUserByUid(uid))
    .filter(Boolean)
)
</script>

<template>
  <div>
    <!-- 用户列表 -->
    <div v-for="user in users" :key="user.uid">
      <label>
        <input
          type="checkbox"
          :value="user.uid"
          v-model="selectedUids"
        />
        {{ user.realName }}
      </label>
    </div>

    <!-- 已选用户 -->
    <div>
      <h3>已选: {{ selectedUsers.length }} 人</h3>
      <div v-for="user in selectedUsers" :key="user.uid">
        {{ user.realName }}
      </div>
    </div>
  </div>
</template>
```

## 更多示例

查看完整的可视化示例页面:
- 启动项目: `pnpm dev`
- 访问: `http://localhost:3000/account-demo`
- 源码: `app/pages/account-demo.vue`
