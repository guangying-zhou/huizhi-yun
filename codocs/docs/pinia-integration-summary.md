# Pinia Account Store 集成完成

## 概述

已成功在项目中集成 `@pinia/nuxt`，用于统一管理从 Account 模块获取的部门、用户、项目信息等。

## 安装的依赖

```json
{
  "@pinia/nuxt": "^0.11.3",
  "pinia": "^3.0.4"
}
```

## 新增文件

### 1. 类型定义
- `app/types/account.ts` - Account 相关的 TypeScript 类型定义

### 2. Store
- `app/stores/account.ts` - Pinia Store，管理用户、部门、项目数据及缓存

### 3. Composables
- `app/composables/useAccount.ts` - 便捷的 composable 函数，简化 Store 使用

### 4. API 端点
- `server/api/account/users/index.get.ts` - 获取用户列表
- `server/api/account/users/[uid].get.ts` - 获取单个用户详情
- `server/api/account/users/batch.post.ts` - 批量获取用户
- `server/api/account/users/[uid]/project.get.ts` - 获取用户的项目
- `server/api/account/departments.get.ts` - 获取部门列表
- `server/api/account/projects/index.get.ts` - 获取项目列表
- `server/api/account/projects/[projectCode].get.ts` - 获取单个项目详情

### 5. 文档和示例
- `docs/pinia-account-store.md` - 详细的使用文档
- `app/pages/account-demo.vue` - 可视化示例页面 (访问 `/account-demo`)

## 配置变更

### nuxt.config.ts
添加了 `@pinia/nuxt` 模块：
```typescript
modules: ['@nuxt/eslint', '@nuxt/ui', '@vueuse/nuxt', '@pinia/nuxt']
```

## 功能特性

### Store 功能
1. **用户管理**
   - 获取用户列表（支持搜索和部门筛选）
   - 获取单个用户详情
   - 批量获取用户
   - 用户信息缓存

2. **部门管理**
   - 获取部门树形结构
   - 获取部门扁平列表
   - 部门信息缓存

3. **项目管理**
   - 获取项目列表（支持多条件筛选）
   - 获取单个项目详情
   - 获取用户的项目（管理的和参与的）
   - 项目信息缓存

4. **缓存管理**
   - 智能缓存机制
   - 支持强制刷新
   - 可清除指定或全部缓存

### Composables
提供了易用的 composable 函数：
- `useAccountUser(uid)` - 获取单个用户
- `useAccountUsers(uids)` - 批量获取用户
- `useAccountDepartments()` - 获取部门信息
- `useAccountProject(projectCode)` - 获取单个项目
- `useAccountUserProjects(uid)` - 获取用户项目
- `useAccountUserSearch()` - 用户搜索
- `useAccountProjectSearch()` - 项目搜索

## 快速开始

### 1. 在组件中使用 Store

```vue
<script setup lang="ts">
import { useAccountStore } from '~/stores/account'

const accountStore = useAccountStore()

// 获取数据
await accountStore.fetchDepartments()
await accountStore.fetchUsers()

// 使用 getter
const departments = computed(() => accountStore.departmentTree)
const users = computed(() => accountStore.allUsers)
</script>
```

### 2. 使用 Composable (推荐)

```vue
<script setup lang="ts">
import { useAccountDepartments, useAccountUser } from '~/composables/useAccount'

// 自动加载部门数据
const { departments, loading } = useAccountDepartments()

// 自动加载用户数据
const uid = ref('zhangsan')
const { user } = useAccountUser(uid)
</script>
```

### 3. 查看示例页面

启动开发服务器后，访问 `/account-demo` 查看完整的交互示例。

```bash
pnpm dev
# 访问 http://localhost:3000/account-demo
```

## API 端点说明

所有 API 端点都会：
1. 自动从环境变量读取 Account API 配置
2. 处理认证（Bearer Token）
3. 统一错误处理
4. 返回标准的 ApiResponse 格式

### 端点列表

| 方法 | 路径                                 | 说明         |
| ---- | ------------------------------------ | ------------ |
| GET  | `/api/account/users`                 | 获取用户列表 |
| GET  | `/api/account/users/:uid`            | 获取用户详情 |
| POST | `/api/account/users/batch`           | 批量获取用户 |
| GET  | `/api/account/users/:uid/project`   | 获取用户项目 |
| GET  | `/api/account/departments`           | 获取部门列表 |
| GET  | `/api/account/project`              | 获取项目列表 |
| GET  | `/api/account/projects/:projectCode` | 获取项目详情 |

## 环境配置

确保配置了以下环境变量：

```env
HZY_CONSOLE_API_URL=https://account.wiztek.cn
HZY_ACCOUNT_API_KEY=your_api_key
HZY_ACCOUNT_API_SECRET=your_api_secret
```

## 最佳实践

1. **使用 Composable 而非直接使用 Store**
   - Composable 提供了自动加载、错误处理等功能
   - 代码更简洁易读

2. **合理使用缓存**
   - 默认情况下数据会被缓存
   - 需要最新数据时使用 `force: true` 参数
   - 定期清理不需要的缓存

3. **批量操作**
   - 需要多个用户信息时使用 `fetchUsersBatch` 而非多次调用 `fetchUser`
   - 提高性能，减少 API 调用次数

4. **错误处理**
   - Composable 自动处理错误并暴露 `error` ref
   - 可以根据 `error` 状态显示错误提示

## 注意事项

1. Store 仅在客户端可用，服务端需要直接调用 API 端点
2. 数据缓存在内存中，页面刷新后会清空
3. 所有 API 调用都需要配置有效的 API Key
4. 支持 TypeScript 类型检查和智能提示

## 相关文档

- [详细使用指南](./pinia-account-store.md)
- [Account API 文档](./Account-API.md)
- [示例页面源码](../app/pages/account-demo.vue)

## 下一步

可以在项目中的其他地方使用 Account Store：
- 用户选择器组件
- 部门树组件
- 项目管理页面
- 权限验证
- 数据关联和展示

享受统一的数据管理体验！🎉
