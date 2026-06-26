<!--
  Pinia Account Store 使用示例页面
  访问路径: /account-demo
-->
<script setup lang="ts">
import { useAccountStore } from '~/stores/account'
import {
  useAccountUser,
  useAccountDepartments,
  useAccountUserProjects,
  useAccountUserSearch
} from '~/composables/useAccount'

// 方式 1: 直接使用 Store
const accountStore = useAccountStore()

// 方式 2: 使用 Composable (推荐)
const { departments, departmentsFlat, loading: deptLoading, reload: reloadDepts } = useAccountDepartments()

// 用户搜索
const {
  searchKeyword,
  deptCode,
  users,
  loading: searchLoading,
  search
} = useAccountUserSearch()

// 选中的用户
const selectedUid = ref<string>('')
const { user: selectedUser, loading: userLoading } = useAccountUser(selectedUid)

// 用户项目
const {
  managedProjects,
  joinedProjects,
  loading: projectsLoading
} = useAccountUserProjects(selectedUid)

// 统计数据
const stats = computed(() => ({
  totalUsers: users.value.length,
  totalDepartments: departmentsFlat.value.length, // 使用扁平列表获取总数
  managedProjectsCount: managedProjects.value.length,
  joinedProjectsCount: joinedProjects.value.length
}))

// 选择用户
const selectUser = (uid: string) => {
  selectedUid.value = uid
}

// 清除缓存
const clearCache = () => {
  accountStore.clearAllCache()
  alert('缓存已清除')
}

const getAvatarSrc = (avatar: unknown) => resolveAvatarSrc(avatar)
</script>

<template>
  <div class="account-demo-page">
    <div class="container mx-auto p-6 max-w-7xl pb-20">
      <div class="flex justify-between items-center mb-6">
        <h1 class="text-3xl font-bold">
          Account Store 示例
        </h1>
        <UButton color="error" variant="outline" @click="clearCache">
          清除所有缓存
        </UButton>
      </div>

      <!-- 统计卡片 -->
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <UCard>
          <div class="text-center">
            <div class="text-3xl font-bold text-primary">
              {{ stats.totalUsers }}
            </div>
            <div class="text-sm text-gray-500 mt-1">
              用户总数
            </div>
          </div>
        </UCard>
        <UCard>
          <div class="text-center">
            <div class="text-3xl font-bold text-primary">
              {{ stats.totalDepartments }}
            </div>
            <div class="text-sm text-gray-500 mt-1">
              部门总数
            </div>
          </div>
        </UCard>
        <UCard>
          <div class="text-center">
            <div class="text-3xl font-bold text-primary">
              {{ stats.managedProjectsCount }}
            </div>
            <div class="text-sm text-gray-500 mt-1">
              管理项目
            </div>
          </div>
        </UCard>
        <UCard>
          <div class="text-center">
            <div class="text-3xl font-bold text-primary">
              {{ stats.joinedProjectsCount }}
            </div>
            <div class="text-sm text-gray-500 mt-1">
              参与项目
            </div>
          </div>
        </UCard>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- 左侧：搜索和用户列表 -->
        <div>
          <UCard>
            <template #header>
              <div class="flex justify-between items-center">
                <h2 class="text-xl font-semibold">
                  用户搜索
                </h2>
                <UButton
                  v-if="!searchLoading"
                  icon="i-lucide-refresh-cw"
                  variant="ghost"
                  size="sm"
                  @click="search"
                />
              </div>
            </template>

            <!-- 搜索框 -->
            <div class="space-y-4 mb-4">
              <UInput v-model="searchKeyword" placeholder="搜索用户名、姓名或邮箱..." icon="i-lucide-search" />

              <USelect
                v-model="deptCode"
                :options="departments"
                option-attribute="name"
                value-attribute="deptCode"
                placeholder="选择部门筛选"
                :loading="deptLoading"
              />
            </div>

            <!-- 用户列表 -->
            <div v-if="searchLoading" class="text-center py-8">
              <UIcon name="i-lucide-loader-2" class="animate-spin text-2xl" />
            </div>

            <div v-else-if="users.length > 0" class="space-y-2">
              <div
                v-for="user in users"
                :key="user.uid"
                class="p-3 rounded-lg border hover:bg-gray-50 cursor-pointer transition-colors"
                :class="{
                  'bg-primary-50 border-primary-300': selectedUid === user.uid
                }"
                @click="selectUser(user.uid)"
              >
                <div class="flex items-center gap-3">
                  <UAvatar :src="getAvatarSrc(user.avatar)" :alt="user.realName" size="md" />
                  <div class="flex-1">
                    <div class="font-medium">
                      {{ user.realName }}
                    </div>
                    <div class="text-sm text-gray-500">
                      @{{ user.uid }} · {{ user.deptName || '未分配部门' }}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div v-else class="text-center py-8 text-gray-500">
              暂无数据
            </div>
          </UCard>
        </div>

        <!-- 右侧：用户详情和项目 -->
        <div class="space-y-6">
          <!-- 用户详情 -->
          <UCard>
            <template #header>
              <h2 class="text-xl font-semibold">
                用户详情
              </h2>
            </template>

            <div v-if="userLoading" class="text-center py-8">
              <UIcon name="i-lucide-loader-2" class="animate-spin text-2xl" />
            </div>

            <div v-else-if="selectedUser" class="space-y-4">
              <div class="flex items-center gap-4">
                <UAvatar :src="getAvatarSrc(selectedUser.avatar)" :alt="selectedUser.realName" size="xl" />
                <div>
                  <div class="text-2xl font-bold">
                    {{ selectedUser.realName }}
                  </div>
                  <div class="text-gray-500">
                    @{{ selectedUser.uid }}
                  </div>
                </div>
              </div>

              <div class="space-y-2">
                <div class="flex items-center gap-2">
                  <UIcon name="i-lucide-mail" />
                  <span>{{ selectedUser.email }}</span>
                </div>
                <div v-if="selectedUser.mobile" class="flex items-center gap-2">
                  <UIcon name="i-lucide-phone" />
                  <span>{{ selectedUser.mobile }}</span>
                </div>
                <div v-if="selectedUser.deptName" class="flex items-center gap-2">
                  <UIcon name="i-lucide-building" />
                  <span>{{ selectedUser.deptName }}</span>
                </div>
              </div>
            </div>

            <div v-else class="text-center py-8 text-gray-500">
              请从左侧选择一个用户
            </div>
          </UCard>

          <!-- 用户项目 -->
          <UCard v-if="selectedUser">
            <template #header>
              <h2 class="text-xl font-semibold">
                参与项目
              </h2>
            </template>

            <div v-if="projectsLoading" class="text-center py-8">
              <UIcon name="i-lucide-loader-2" class="animate-spin text-2xl" />
            </div>

            <div v-else class="space-y-6">
              <!-- 管理的项目 -->
              <div v-if="managedProjects.length > 0">
                <h3 class="font-semibold mb-2 flex items-center gap-2">
                  <UIcon name="i-lucide-crown" class="text-amber-500" />
                  管理的项目
                </h3>
                <div class="space-y-2">
                  <div
                    v-for="project in managedProjects"
                    :key="project.projectCode"
                    class="p-3 rounded-lg border bg-amber-50 border-amber-200"
                  >
                    <div class="font-medium">
                      {{ project.name }}
                    </div>
                    <div class="text-sm text-gray-600">
                      {{ project.projectCode }}
                    </div>
                  </div>
                </div>
              </div>

              <!-- 参与的项目 -->
              <div v-if="joinedProjects.length > 0">
                <h3 class="font-semibold mb-2 flex items-center gap-2">
                  <UIcon name="i-lucide-users" class="text-blue-500" />
                  参与的项目
                </h3>
                <div class="space-y-2">
                  <div
                    v-for="project in joinedProjects"
                    :key="project.projectCode"
                    class="p-3 rounded-lg border bg-blue-50 border-blue-200"
                  >
                    <div class="font-medium">
                      {{ project.name }}
                    </div>
                    <div class="text-sm text-gray-600">
                      {{ project.projectCode }}
                    </div>
                  </div>
                </div>
              </div>

              <div
                v-if="managedProjects.length === 0 && joinedProjects.length === 0"
                class="text-center py-8 text-gray-500"
              >
                该用户未参与任何项目
              </div>
            </div>
          </UCard>
        </div>
      </div>

      <!-- 部门树 -->
      <UCard class="mt-6">
        <template #header>
          <div class="flex justify-between items-center">
            <h2 class="text-xl font-semibold">
              部门结构
            </h2>
            <UButton
              v-if="!deptLoading"
              icon="i-lucide-refresh-cw"
              variant="ghost"
              size="sm"
              @click="reloadDepts"
            />
          </div>
        </template>

        <div v-if="deptLoading" class="text-center py-8">
          <UIcon name="i-lucide-loader-2" class="animate-spin text-2xl" />
        </div>

        <div v-else-if="departments.length > 0" class="space-y-2">
          <div v-for="dept in departments" :key="dept.deptCode" class="p-3 rounded-lg border hover:bg-gray-50">
            <div class="font-medium">
              {{ dept.name }}
            </div>
            <div class="text-sm text-gray-500">
              {{ dept.deptCode }}
            </div>

            <!-- 子部门 -->
            <div v-if="dept.children && dept.children.length > 0" class="ml-6 mt-2 space-y-2">
              <div v-for="child in dept.children" :key="child.deptCode" class="p-2 rounded border bg-gray-50">
                <div class="font-medium text-sm">
                  {{ child.name }}
                </div>
                <div class="text-xs text-gray-500">
                  {{ child.deptCode }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="text-center py-8 text-gray-500">
          暂无部门数据
        </div>
      </UCard>
    </div>
  </div>
</template>

<style scoped>
.account-demo-page {
  min-height: 100vh;
  height: auto;
  overflow-y: auto;
  overflow-x: hidden;
}
</style>
