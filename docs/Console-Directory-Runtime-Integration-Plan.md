# Console 整合 Directory Runtime 实现计划

状态：Draft
日期：2026-04-26
定位：把现有 `account` 的企业目录能力收敛到 `console` 的实施计划；配套 `Huizhi-yun-Architecture.md`、`Huizhi-yun-Platform-Target-Architecture.md`、`Directory-Runtime-Contract.md`、`Account-Directory-Runtime-Refactor-Plan.md` 与 `Console-Workflow-Runtime-Integration-Plan.md`

---

## 1. 背景与决策

### 1.1 背景

当前企业端基础能力拆成多个服务：

- `console`：企业资料、系统参数、集成配置、credential-vault、本地 service client。
- `account`：用户、部门、项目注册表、LDAP/CAS/企业微信等目录与登录能力。
- `workflow`：当前独立审批流程；目标收敛为 `console.workflow-runtime`，详见 `Console-Workflow-Runtime-Integration-Plan.md`。

这个拆法在历史上有利于快速上线，但对企业私有化部署不够简洁：

- 每个企业至少多部署一个 `account` 服务和数据库。
- `console.env` / `license.lic` / runtime token 只由 `console` 消费，但目录同步又在 `account`，企业端基础运行链路被拆散。
- 业务应用需要同时依赖 `console` 与 `account`，Foundation adapter 的责任边界更复杂。
- platform subject sync 的理想来源是企业端基础运行时，但当前目录权威源在另一个服务。

### 1.2 决策

目标形态：

```text
console =
  org-profile
  system-settings
  integration-config
  credential-vault
  service-client
  directory-runtime
  auth-runtime
  workflow-runtime（另案实施）
  account-compat facade（迁移期）
```

`directory-runtime` 是逻辑域与 API 契约，不要求长期作为独立服务存在。现有 `account` 是迁移期的目录事实源、兼容 facade 和数据迁移源。`workflow-runtime` 采用同样原则，默认并入 Console，保留未来物理拆分边界。

### 1.3 不做什么

本计划不把 `account` 的所有职责原样搬进 `console`。

明确不迁入：

- 平台授权治理、角色模板、应用授权、License、policy bundle。
- AI gateway 等非目录基础能力。
- 历史 platform-like 管理表或 SaaS 运营能力。
- 业务应用主数据。

---

## 2. 目标架构

### 2.1 调用关系

目标链路：

```text
platform
  -> console runtime channel
  -> policy bundle / license / heartbeat / subject sync

business apps
  -> foundation directory adapter
  -> console directory-runtime

workflow
  -> foundation directory adapter
  -> console directory-runtime
```

过渡链路：

```text
business apps
  -> foundation directory adapter
  -> console directory-runtime
```

### 2.2 模块边界

| 模块 | 目标职责 | 迁移期职责 |
|------|----------|------------|
| `console` | 企业基础配置、凭证保险箱、本地 service client、目录运行时、本地 auth runtime、platform activation | 新增 directory-runtime 域，兼容 Account API 的 facade |
| `account` | 无长期必选独立职责 | 保持现有生产目录服务，作为一次性迁移源和旧版本兼容服务 |
| `foundation` | 无状态 adapter：认证、目录、workflow、platform runtime client | 新目录 adapter 只接 Console；不提供 Account fallback |
| `platform` | 只治理租户、部署、license、bundle、最小 subject | 不存目录 PII，不直连 console/account DB |

### 2.3 数据权威源

| 数据域 | 当前权威源 | 目标权威源 | 稳定标识 |
|--------|------------|------------|----------|
| 用户 | `account.users` | `console.directory_users` | `uid` |
| 部门 | `account.departments` | `console.directory_departments` | `dept_code` |
| 项目注册表 | `account.projects` / Git project registry | `console.directory_projects` | `project_code` |
| 外部身份映射 | `account` identities | `console.directory_identities` | `provider + external_subject` |
| 应用终端最小 subject | `platform.tenant_subjects` | platform 拉取 console 最小投影 | `subject_code / external_ref` |

---

## 3. 目标能力清单

### 3.1 Directory Runtime

负责：

- 用户档案：`uid / status / display fields / primary_dept_code`。
- 部门树：`dept_code / parent_dept_code / sort_order / status`。
- 岗位/角色标签：仅目录属性，不等同 platform 权限角色。
- 项目注册表：`project_code / project_name / owner_uid / dept_code / status`。
- 外部目录同步：LDAP / CAS / 企业微信 / OIDC / GitLab 用户映射。
- 字段映射与同步审计。
- 最小 subject 投影：供 Console subject sync worker 读取后回传 Platform，不包含姓名、邮箱、手机等 PII。

### 3.2 Auth Runtime

负责：

- 企业本地登录会话。
- CAS / OIDC / 企业微信登录回调。
- 将外部身份解析为本地 `uid`。
- 与 Foundation `useAuth` / server auth bridge 对齐。

不负责：

- platform control-plane account 登录。
- platform policy bundle 签发。
- 跨租户 federation。

### 3.3 Account Compat Facade

迁移期提供兼容接口：

- `/api/v1/users`
- `/api/v1/users/{uid}`
- `/api/v1/users/batch`
- `/api/v1/departments`
- `/api/v1/projects`
- `/api/v1/heartbeat`（可保留为用户在线心跳兼容接口）

兼容层目标：

- 让业务应用和 Foundation 不需要一次性大改。
- 兼容响应结构，内部数据源切到 console directory tables。
- 稳定后逐步废弃 `HZY_ACCOUNT_API_*` 配置。

---

## 4. 数据模型草案

> 详细 DDL 后续落到 `console/docs/hzy_console_schema.sql` 或独立迁移文件。这里先定义领域对象。

### 4.1 目录主表

```sql
directory_users
  uid / username / display_name / email / mobile / avatar_url
  primary_dept_code / status / source_provider / external_ref
  synced_at / created_at / updated_at

directory_departments
  dept_code / parent_dept_code / dept_name / dept_path / sort_order
  status / source_provider / external_ref / synced_at

directory_user_departments
  uid / dept_code / relation_type / is_primary / status
  source_provider / external_ref / joined_at / left_at

directory_projects
  project_code / project_name / owner_uid / dept_code / status
  source_provider / external_ref / synced_at

directory_project_members
  project_code / uid / member_role / status
  source_provider / external_ref / joined_at / left_at
```

### 4.2 身份映射

```sql
directory_identities
  uid / provider_code / provider_subject / provider_username
  email / mobile_tail4 / status / last_login_at

local_sessions
  session_id / uid / identity_id / auth_provider / issued_at
  last_seen_at / expires_at / revoked_at / status

auth_login_events
  uid / identity_id / target_app / auth_provider / login_type
  login_result / failure_reason / ip_address / session_id / created_at
```

### 4.3 同步任务

```sql
directory_sync_jobs
  job_code / provider_code / sync_type / cursor / status
  started_at / finished_at / error_message

directory_sync_events
  job_code / object_type / object_code / action / status / message
```

### 4.4 Platform subject 投影

```sql
directory_subject_exports
  subject_type / subject_code / external_ref / parent_subject_code
  status / snapshot_hash / exported_at
```

约束：

- `directory_subject_exports` 不保存真实姓名、邮箱、手机。
- platform 拉取 subject 时只消费该最小投影。
- 当源目录行被硬删除时，Console 重建投影必须将对应 export 行标记为 `inactive`，而不是保留旧 `active` 状态；Platform 收到 `inactive/deleted` 后将租户主体状态映射为 disabled。

---

## 5. API 计划

### 5.1 Console Directory API

建议前缀：

```text
/api/v1/console/directory/**
```

核心接口：

| 接口 | 用途 |
|------|------|
| `GET /users` | 用户列表，支持 `keyword / deptCode / status` |
| `GET /users/{uid}` | 用户详情 |
| `POST /users/batch` | 批量用户查询 |
| `GET /departments` | 部门树或扁平列表 |
| `GET /departments/{deptCode}/members` | 部门成员 |
| `GET /projects` | 项目注册表 |
| `GET /subjects/export` | Console subject sync worker 使用的最小投影 |
| `POST /sync-jobs` | 管理端触发目录同步 |
| `GET /sync-jobs/{jobCode}` | 同步任务状态 |

### 5.2 Account 兼容 API

建议保留：

```text
/api/v1/users
/api/v1/departments
/api/v1/projects
```

内部实现切换策略：

1. 优先读 `console.directory_*` 表。
2. 不再新增 Account fallback；迁移期旧 Account API 由 Account 自身继续提供。
3. 记录调用日志，用于判断旧客户端何时可下线或跳转到 Console 新接口。

### 5.3 Foundation Adapter

目标：业务模块只依赖 Foundation 的目录语义，新目录能力统一读取 `console.directory-runtime`；Account 只作为即将废弃的旧入口，不进入 Foundation 新 adapter 的回退链路。

#### 5.3.1 文件与职责

| 文件 | 类型 | 职责 |
|------|------|------|
| `foundation/app/types/directory.ts` | 类型 | 定义 `DirectoryUser / DirectoryDepartment / DirectoryProject / DirectoryMembership / DirectoryMeta` 等目标类型 |
| `foundation/server/utils/directoryApi.ts` | 服务端工具 | 读取 runtimeConfig，校验 Console Directory API 配置并调用 Console |
| `foundation/app/composables/useDirectory.ts` | 客户端 composable | 提供 `useDirectoryUsers / useDirectoryUser / useDirectoryDepartments / useDirectoryProjects / useDirectoryUserProjects` |
| `foundation/app/stores/directory.ts` | Pinia store | 缓存用户、部门、项目、用户项目关系；替代 `stores/account.ts` 的目录语义 |
| `foundation/app/composables/useAccount.ts` | 兼容层 | 短期保留原函数名，内部调用 `useDirectory*` 并做字段映射 |
| `foundation/app/stores/account.ts` | 兼容层 | 短期保留原 store 名，内部委托 `directory` store 或复用同一数据源 |

不建议在 Foundation 直接放 `server/api/directory/**` 路由。原因与旧 `/api/account/**` 相同：`account` / `console` 自身也可能 extends Foundation，Foundation 内置代理路由容易形成循环。每个业务模块按需在本模块 `server/api/directory/**` 下薄代理到 `directoryApi.ts`。

#### 5.3.2 runtimeConfig 与环境变量

建议配置：

```ts
runtimeConfig: {
  hzy: {
    directory: {
      provider: process.env.HZY_DIRECTORY_PROVIDER || 'console',
      consoleApiUrl: process.env.HZY_CONSOLE_API_URL || '',
      consoleClientId: process.env.HZY_CONSOLE_CLIENT_ID || '',
      consoleClientSecret: process.env.HZY_CONSOLE_CLIENT_SECRET || '',
      timeoutMs: Number(process.env.HZY_DIRECTORY_TIMEOUT_MS || 10000)
    }
  }
}
```

Provider 取值收敛为一个目标值：

| provider | 行为 |
|----------|------|
| `console` | 只读 Console Directory API；未配置或调用失败直接抛错 |

环境变量要求：

1. `HZY_DIRECTORY_PROVIDER=console`
2. `HZY_CONSOLE_API_URL`
3. `HZY_CONSOLE_CLIENT_ID + HZY_CONSOLE_CLIENT_SECRET`

约束：

- 不支持 `auto`，避免因配置缺失静默回到 Account。
- 不支持 `dual`，避免为短生命周期 Account 增加双读对账复杂度。
- 不支持 Foundation 内置 Account fallback；旧 `/api/account/**` 可以保留名称，但内部应调用 Console Directory adapter。

#### 5.3.3 服务端工具接口

```ts
export type DirectoryProvider = 'console'

export interface DirectoryConfig {
  provider: DirectoryProvider
  consoleApiUrl: string
  consoleClientId?: string
  consoleClientSecret?: string
  timeoutMs: number
}

export interface DirectoryListOptions {
  search?: string
  status?: 'active' | 'inactive' | 'deleted'
  cursor?: string
  limit?: number
}

export interface DirectoryUserListOptions extends DirectoryListOptions {
  deptCode?: string
}

export interface DirectoryProjectListOptions extends Omit<DirectoryListOptions, 'status'> {
  deptCode?: string
  ownerUid?: string
  leaderUid?: string
  status?: 'active' | 'inactive' | 'archived' | 'deleted'
}

export function getDirectoryConfig(): DirectoryConfig
export function requireDirectoryConfig(): DirectoryConfig
export function getDirectoryAuthHeaders(config?: DirectoryConfig): Record<string, string>

export async function fetchDirectoryApi<T>(
  path: string,
  options?: {
    method?: 'GET' | 'POST'
    params?: Record<string, unknown>
    body?: unknown
  }
): Promise<T>

export async function getDirectoryMeta(): Promise<DirectoryMeta>
export async function listDirectoryUsers(options?: DirectoryUserListOptions): Promise<DirectoryPage<DirectoryUser>>
export async function getDirectoryUser(uid: string): Promise<DirectoryUser | null>
export async function batchResolveDirectoryUsers(uids: string[]): Promise<DirectoryUserBatchResult>
export async function listDirectoryDepartments(options?: { includeInactive?: boolean, orgType?: string }): Promise<DirectoryDepartmentResponse>
export async function getDirectoryDepartment(deptCode: string): Promise<DirectoryDepartment | null>
export async function listDirectoryDepartmentMembers(deptCode: string, options?: DirectoryListOptions): Promise<DirectoryPage<DirectoryDepartmentMember>>
export async function listDirectoryUserDepartments(options?: DirectoryListOptions): Promise<DirectoryPage<DirectoryMembership>>
export async function listDirectoryProjects(options?: DirectoryProjectListOptions): Promise<DirectoryPage<DirectoryProject>>
export async function getDirectoryProject(projectCode: string): Promise<DirectoryProject | null>
export async function listDirectoryUserProjects(uid: string, options?: DirectoryListOptions): Promise<DirectoryUserProjects>
```

实现要求：

- `console` provider 使用 `Authorization: Basic base64(client_id:client_secret)` 调 Console。
- `HZY_DIRECTORY_PROVIDER` 只接受 `console`；其他值视为配置错误。
- `HZY_CONSOLE_API_URL` 缺失时直接报 `DIR_CONFIG_MISSING`。
- Console 连接失败时直接报 `DIR_UPSTREAM_UNAVAILABLE`，不 fallback Account。
- 所有服务端 helper 返回统一 `Directory*` 类型，不把 Account 原始响应继续向上冒泡。

#### 5.3.4 前端类型

```ts
export interface DirectoryUser {
  uid: string
  username?: string | null
  displayName?: string | null
  realName?: string | null
  nickname?: string | null
  avatarUrl?: string | null
  email?: string | null
  mobile?: string | null
  mobileTail4?: string | null
  positionTitle?: string | null
  primaryDeptCode?: string | null
  primaryDeptName?: string | null
  userType: 'system' | 'employee' | 'external' | 'service'
  status: 'active' | 'inactive' | 'pending' | 'deleted'
}

export interface DirectoryDepartment {
  deptCode: string
  deptName: string
  parentDeptCode?: string | null
  levelNo?: number
  orgType?: 'department' | 'committee' | 'virtual'
  managerUid?: string | null
  leaderUid?: string | null
  children?: DirectoryDepartment[]
  status: 'active' | 'inactive' | 'deleted'
}

export interface DirectoryMembership {
  uid: string
  deptCode: string
  relationType: 'member' | 'manager' | 'leader' | 'observer'
  isPrimary: boolean
  status: 'active' | 'inactive' | 'deleted'
}

export interface DirectoryProject {
  projectCode: string
  projectName: string
  parentProjectCode?: string | null
  projectType: 'group' | 'project' | 'template'
  deptCode?: string | null
  ownerUid?: string | null
  leaderUid?: string | null
  repoUrl?: string | null
  status: 'active' | 'inactive' | 'archived' | 'deleted'
}

export interface DirectoryUserProjects {
  managed: DirectoryProject[]
  joined: DirectoryProject[]
}

export interface DirectoryDepartmentResponse {
  tree: DirectoryDepartment[]
  flat: DirectoryDepartment[]
}

export interface DirectoryDepartmentMember {
  user: DirectoryUser
  membership: DirectoryMembership
}

export interface DirectoryUserBatchResult {
  items: Record<string, DirectoryUser>
  missingUids: string[]
}

export interface DirectoryMeta {
  contractVersion: string
  snapshotHash: string
  syncCursor?: string | null
  userCount: number
  departmentCount: number
  projectCount: number
  syncLagSeconds: number
  syncStatus: 'healthy' | 'degraded' | 'failed' | 'disabled'
  updatedAt: string
}

export interface DirectoryPage<T> {
  items: T[]
  nextCursor?: string | null
  hasMore?: boolean
}
```

#### 5.3.5 Composables

新增：

```ts
export function useDirectoryUsers(options?: MaybeRef<DirectoryUserListOptions>) {
  return {
    users: Ref<DirectoryUser[]>
    loading: Ref<boolean>
    error: Ref<unknown | null>
    refresh: () => Promise<void>
  }
}

export function useDirectoryUser(uid: Ref<string | null | undefined> | string) {
  return {
    user: Ref<DirectoryUser | null>
    loading: Ref<boolean>
    error: Ref<unknown | null>
    refresh: () => Promise<void>
  }
}

export function useDirectoryDepartments(options?: MaybeRef<{ includeInactive?: boolean, orgType?: string }>) {
  return {
    departments: Ref<DirectoryDepartmentResponse | null>
    tree: ComputedRef<DirectoryDepartment[]>
    flat: ComputedRef<DirectoryDepartment[]>
    loading: Ref<boolean>
    error: Ref<unknown | null>
    refresh: () => Promise<void>
  }
}

export function useDirectoryProjects(options?: MaybeRef<DirectoryProjectListOptions>) {
  return {
    projects: Ref<DirectoryProject[]>
    loading: Ref<boolean>
    error: Ref<unknown | null>
    refresh: () => Promise<void>
  }
}

export function useDirectoryUserProjects(uid: Ref<string | null | undefined> | string) {
  return {
    userProjects: Ref<DirectoryUserProjects | null>
    loading: Ref<boolean>
    error: Ref<unknown | null>
    refresh: () => Promise<void>
  }
}
```

兼容别名：

| 旧接口 | 新内部实现 | 兼容策略 |
|--------|------------|----------|
| `useAccountUsers()` | `useDirectoryUsers()` | 返回 `AccountUser[]` 形状，内部从 `DirectoryUser` 映射 |
| `useAccountUser(uid)` | `useDirectoryUser(uid)` | 保留 `realName / avatar / deptCode / deptName` 旧字段 |
| `useAccountDepartments()` | `useDirectoryDepartments()` | 保留 `name / parentId / level / managerId / leaderId` 旧字段 |
| `useAccountProjects()` | `useDirectoryProjects()` | 保留 `name / parentId / leaderUid / isGroup / subProjects` 旧字段 |
| `useAccountUserProjects(uid)` | `useDirectoryUserProjects(uid)` | 保留 `managed / joined` 分组 |

#### 5.3.6 Pinia Store

新增 `useDirectoryStore`：

```ts
export const useDirectoryStore = defineStore('directory', {
  state: () => ({
    users: new Map<string, DirectoryUser>(),
    departments: null as DirectoryDepartmentResponse | null,
    projects: new Map<string, DirectoryProject>(),
    userProjects: new Map<string, DirectoryUserProjects>(),
    meta: null as DirectoryMeta | null,
    lastLoadedAt: null as number | null
  }),
  getters: {
    allUsers: state => Array.from(state.users.values()),
    getUserByUid: state => (uid: string) => state.users.get(uid),
    departmentTree: state => state.departments?.tree || [],
    departmentFlat: state => state.departments?.flat || [],
    getDepartmentByCode: state => (deptCode: string) =>
      state.departments?.flat.find(dept => dept.deptCode === deptCode),
    allProjects: state => Array.from(state.projects.values()),
    getProjectByCode: state => (projectCode: string) => state.projects.get(projectCode)
  },
  actions: {
    fetchUsers,
    fetchUser,
    fetchUsersBatch,
    fetchDepartments,
    fetchProjects,
    fetchUserProjects,
    clearUserCache,
    clearDepartmentCache,
    clearProjectCache,
    clearAllCache
  }
})
```

缓存策略：

- 用户、项目按稳定键缓存：`uid / projectCode`。
- 部门树按整体版本缓存，`DirectoryMeta.snapshotHash` 变化时清空。
- 批量用户解析优先命中本地缓存，只请求 uncached uids。
- Console 返回错误时不使用 Account 兜底；直接暴露统一错误码，促使配置或数据问题尽早修复。

#### 5.3.7 业务模块代理路由建议

业务模块按需提供薄代理，路径保持稳定：

```text
GET  /api/directory/meta
GET  /api/directory/users
GET  /api/directory/users/:uid
POST /api/directory/users/batch
GET  /api/directory/departments
GET  /api/directory/departments/:deptCode
GET  /api/directory/departments/:deptCode/members
GET  /api/directory/user-departments
GET  /api/directory/projects
GET  /api/directory/projects/:projectCode
GET  /api/directory/users/:uid/projects
```

旧 `/api/account/**` 代理短期保留名称，但内部必须调用 `directoryApi.ts`，不再代理独立 Account：

```text
/api/account/users              -> listDirectoryUsers + mapToAccountUsers
/api/account/users/:uid         -> getDirectoryUser + mapToAccountUser
/api/account/users/batch        -> batchResolveDirectoryUsers + mapToAccountUsers
/api/account/departments        -> listDirectoryDepartments + mapToAccountDepartments
/api/account/user-departments   -> listDirectoryUserDepartments + mapToAccountMemberships
/api/account/projects           -> listDirectoryProjects + mapToAccountProjects
/api/account/users/:uid/projects -> listDirectoryUserProjects + mapToAccountUserProjects
```

#### 5.3.8 Account 兼容字段映射

```ts
function mapDirectoryUserToAccountUser(user: DirectoryUser): AccountUser {
  return {
    id: 0,
    uid: user.uid,
    realName: user.realName || user.displayName || user.username || user.uid,
    nickname: user.nickname || null,
    email: user.email || '',
    mobile: user.mobile || null,
    avatar: user.avatarUrl || null,
    status: user.status === 'active' ? 1 : user.status === 'deleted' ? -1 : 0,
    deptCode: user.primaryDeptCode || null,
    deptName: user.primaryDeptName || null
  }
}
```

映射原则：

- 新类型以 `Directory*` 为准，旧 `Account*` 仅为 UI 兼容。
- 旧 `id` 没有稳定意义，迁移后不得继续依赖；兼容层可返回 `0` 或来源 ID 映射值。
- `status` 映射：`active -> 1`，`inactive/pending -> 0`，`deleted -> -1`。
- `avatar` 仍可走 `resolveAvatarSrc`，但目标应从 `avatarUrl` 或 Console avatar proxy 解析。

#### 5.3.9 错误处理

| 场景 | 行为 |
|------|------|
| `HZY_DIRECTORY_PROVIDER` 未设置为 `console` | `DIR_CONFIG_MISSING`，启动或首次调用 fail fast |
| `HZY_CONSOLE_API_URL` 未配置 | `DIR_CONFIG_MISSING` |
| Console 连接失败 / 5xx | `DIR_UPSTREAM_UNAVAILABLE`，不 fallback Account |
| Console 返回 400 / 401 / 403 / 404 | 直接透出统一错误 |
| Console 响应结构不符合契约 | `DIR_CONTRACT_MISMATCH` |

错误码：

| 错误码 | 含义 |
|--------|------|
| `DIR_CONFIG_MISSING` | 当前 provider 所需配置缺失 |
| `DIR_UPSTREAM_UNAVAILABLE` | Console / Account 上游不可用 |
| `DIR_NOT_FOUND` | 目录对象不存在 |
| `DIR_BAD_REQUEST` | 参数不合法 |
| `DIR_CONTRACT_MISMATCH` | 上游返回不符合目录契约 |

#### 5.3.10 迁移步骤

1. 新增 `directory.ts / directoryApi.ts / useDirectory.ts / stores/directory.ts`。
2. 保持 `useAccount.ts / stores/account.ts` 对外签名不变，内部委托 directory adapter。
3. 业务模块新增 `/api/directory/**` 薄代理；旧 `/api/account/**` 继续保留。
4. 各业务模块配置 `HZY_DIRECTORY_PROVIDER=console` 与 `HZY_CONSOLE_API_URL`。
5. 业务代码逐步从 `useAccount*` 改名为 `useDirectory*`。
6. 删除对 `HZY_ACCOUNT_API_URL / HZY_ACCOUNT_API_KEY / HZY_ACCOUNT_API_SECRET` 的新依赖。

### 5.4 Console Directory API OpenAPI 草案

> 说明：本节是实现用草案，不替代后续可生成的正式 OpenAPI 文件。对外字段统一使用 camelCase；不得暴露数据库自增 ID 作为主引用。

```yaml
openapi: 3.0.3
info:
  title: Huizhi Console Directory API
  version: dir.v1
  description: >
    Console 内置 directory-runtime 的目录读取、项目注册表、最小 subject export 与同步任务 API。
    业务应用应通过 Foundation directory adapter 调用；subject sync worker 只能从 subjects/export 读取最小投影。
servers:
  - url: /api/v1/console/directory
security:
  - AdminSession: []
  - ServiceCredential: []
tags:
  - name: Meta
  - name: Users
  - name: Departments
  - name: Projects
  - name: SubjectExport
  - name: SyncJobs
paths:
  /meta:
    get:
      tags: [Meta]
      summary: Get directory runtime contract and health summary
      operationId: getDirectoryMeta
      responses:
        "200":
          description: Directory runtime metadata
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/DirectoryMetaResponse"

  /users:
    get:
      tags: [Users]
      summary: List directory users
      operationId: listDirectoryUsers
      parameters:
        - $ref: "#/components/parameters/Search"
        - $ref: "#/components/parameters/DeptCode"
        - $ref: "#/components/parameters/Status"
        - $ref: "#/components/parameters/Cursor"
        - $ref: "#/components/parameters/Limit"
      responses:
        "200":
          description: Cursor paginated users
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/UserListResponse"

  /users/{uid}:
    get:
      tags: [Users]
      summary: Get a directory user
      operationId: getDirectoryUser
      parameters:
        - $ref: "#/components/parameters/Uid"
      responses:
        "200":
          description: User detail
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/UserDetailResponse"
        "404":
          $ref: "#/components/responses/NotFound"

  /users/batch:
    post:
      tags: [Users]
      summary: Batch resolve users by uid
      operationId: batchResolveDirectoryUsers
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [uids]
              properties:
                uids:
                  type: array
                  minItems: 1
                  maxItems: 500
                  items:
                    type: string
                includeInactive:
                  type: boolean
                  default: false
      responses:
        "200":
          description: Users keyed by uid
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/UserBatchResponse"

  /departments:
    get:
      tags: [Departments]
      summary: List departments as tree and flat list
      operationId: listDirectoryDepartments
      parameters:
        - name: includeInactive
          in: query
          schema:
            type: boolean
            default: false
        - name: orgType
          in: query
          schema:
            type: string
            enum: [department, committee, virtual]
      responses:
        "200":
          description: Department tree and flat list
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/DepartmentListResponse"

  /departments/{deptCode}:
    get:
      tags: [Departments]
      summary: Get a department
      operationId: getDirectoryDepartment
      parameters:
        - $ref: "#/components/parameters/DeptCodePath"
      responses:
        "200":
          description: Department detail
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/DepartmentDetailResponse"
        "404":
          $ref: "#/components/responses/NotFound"

  /departments/{deptCode}/members:
    get:
      tags: [Departments]
      summary: List department members
      operationId: listDirectoryDepartmentMembers
      parameters:
        - $ref: "#/components/parameters/DeptCodePath"
        - name: relationType
          in: query
          schema:
            type: string
            enum: [member, manager, leader, observer]
        - $ref: "#/components/parameters/Cursor"
        - $ref: "#/components/parameters/Limit"
      responses:
        "200":
          description: Cursor paginated department members
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/DepartmentMemberListResponse"

  /user-departments:
    get:
      tags: [Departments]
      summary: List user-department memberships
      operationId: listDirectoryUserDepartments
      parameters:
        - name: changedAfter
          in: query
          schema:
            type: string
            format: date-time
        - $ref: "#/components/parameters/Cursor"
        - $ref: "#/components/parameters/Limit"
      responses:
        "200":
          description: Cursor paginated memberships
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/UserDepartmentListResponse"

  /projects:
    get:
      tags: [Projects]
      summary: List project registry entries
      operationId: listDirectoryProjects
      parameters:
        - $ref: "#/components/parameters/Search"
        - $ref: "#/components/parameters/DeptCode"
        - name: ownerUid
          in: query
          schema:
            type: string
        - $ref: "#/components/parameters/ProjectStatus"
        - $ref: "#/components/parameters/Cursor"
        - $ref: "#/components/parameters/Limit"
      responses:
        "200":
          description: Cursor paginated project registry
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ProjectListResponse"

  /projects/{projectCode}:
    get:
      tags: [Projects]
      summary: Get a project registry entry
      operationId: getDirectoryProject
      parameters:
        - $ref: "#/components/parameters/ProjectCodePath"
      responses:
        "200":
          description: Project registry detail
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ProjectDetailResponse"
        "404":
          $ref: "#/components/responses/NotFound"

  /users/{uid}/projects:
    get:
      tags: [Projects]
      summary: List projects related to a user
      operationId: listDirectoryUserProjects
      parameters:
        - $ref: "#/components/parameters/Uid"
        - $ref: "#/components/parameters/Cursor"
        - $ref: "#/components/parameters/Limit"
      responses:
        "200":
          description: Cursor paginated user project registry
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ProjectListResponse"

  /subjects/export:
    get:
      tags: [SubjectExport]
      summary: Export minimal subjects for local subject sync worker
      operationId: exportDirectorySubjects
      description: >
        Returns only minimal stable subject records. Response MUST NOT include displayName,
        realName, email, mobile, avatarUrl, deptName, projectName or other PII/display fields.
      parameters:
        - name: subjectType
          in: query
          schema:
            type: string
            enum: [user, department, project]
        - $ref: "#/components/parameters/Status"
        - name: changedAfter
          in: query
          schema:
            type: string
            format: date-time
        - $ref: "#/components/parameters/Cursor"
        - $ref: "#/components/parameters/Limit"
      responses:
        "200":
          description: Cursor paginated minimal subject projection
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SubjectExportResponse"

  /sync-jobs:
    post:
      tags: [SyncJobs]
      summary: Start a directory sync job
      operationId: startDirectorySyncJob
      security:
        - AdminSession: []
        - ServiceCredential: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/StartSyncJobRequest"
      responses:
        "202":
          description: Sync job accepted
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SyncJobResponse"

  /sync-jobs/{jobCode}:
    get:
      tags: [SyncJobs]
      summary: Get directory sync job status
      operationId: getDirectorySyncJob
      parameters:
        - name: jobCode
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Sync job status
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SyncJobResponse"
        "404":
          $ref: "#/components/responses/NotFound"

components:
  securitySchemes:
    AdminSession:
      type: apiKey
      in: cookie
      name: console_session
    ServiceCredential:
      type: http
      scheme: basic
      description: Basic base64(client_id:client_secret) from console service_client_credentials.

  parameters:
    Search:
      name: search
      in: query
      schema:
        type: string
        maxLength: 128
    Cursor:
      name: cursor
      in: query
      schema:
        type: string
    Limit:
      name: limit
      in: query
      schema:
        type: integer
        minimum: 1
        maximum: 500
        default: 50
    Status:
      name: status
      in: query
      schema:
        type: string
        enum: [active, inactive, deleted]
    ProjectStatus:
      name: status
      in: query
      schema:
        type: string
        enum: [active, inactive, archived, deleted]
    Uid:
      name: uid
      in: path
      required: true
      schema:
        type: string
    DeptCode:
      name: deptCode
      in: query
      schema:
        type: string
    DeptCodePath:
      name: deptCode
      in: path
      required: true
      schema:
        type: string
    ProjectCodePath:
      name: projectCode
      in: path
      required: true
      schema:
        type: string

  responses:
    NotFound:
      description: Object not found
      content:
        application/json:
          schema:
            $ref: "#/components/schemas/ErrorResponse"

  schemas:
    ApiEnvelope:
      type: object
      required: [code, message, traceId]
      properties:
        code:
          type: integer
          example: 0
        message:
          type: string
          example: ok
        traceId:
          type: string
          example: req_20260426_xxx

    ErrorResponse:
      allOf:
        - $ref: "#/components/schemas/ApiEnvelope"
        - type: object
          properties:
            code:
              type: integer
              example: 404
            message:
              type: string
              example: DIR_NOT_FOUND
            data:
              nullable: true

    CursorPage:
      type: object
      required: [items]
      properties:
        nextCursor:
          type: string
          nullable: true
        hasMore:
          type: boolean
          default: false

    DirectoryMeta:
      type: object
      required: [serviceRole, appCode, capability, contractVersion, snapshotHash, syncStatus, updatedAt]
      properties:
        serviceRole:
          type: string
          enum: [base_runtime]
        appCode:
          type: string
          enum: [console]
        capability:
          type: string
          enum: [directory_runtime]
        contractVersion:
          type: string
          example: dir.v1
        snapshotHash:
          type: string
        syncCursor:
          type: string
          nullable: true
        userCount:
          type: integer
        departmentCount:
          type: integer
        projectCount:
          type: integer
        syncLagSeconds:
          type: integer
        syncStatus:
          type: string
          enum: [healthy, degraded, failed, disabled]
        updatedAt:
          type: string
          format: date-time

    DirectoryUser:
      type: object
      required: [uid, status]
      properties:
        uid:
          type: string
        username:
          type: string
          nullable: true
        displayName:
          type: string
          nullable: true
        realName:
          type: string
          nullable: true
        nickname:
          type: string
          nullable: true
        avatarUrl:
          type: string
          nullable: true
        email:
          type: string
          nullable: true
        mobile:
          type: string
          nullable: true
        mobileTail4:
          type: string
          nullable: true
        positionTitle:
          type: string
          nullable: true
        primaryDeptCode:
          type: string
          nullable: true
        primaryDeptName:
          type: string
          nullable: true
        userType:
          type: string
          enum: [system, employee, external, service]
        sourceProvider:
          type: string
        externalRef:
          type: string
          nullable: true
        status:
          type: string
          enum: [active, inactive, pending, deleted]
        syncedAt:
          type: string
          format: date-time
          nullable: true
        updatedAt:
          type: string
          format: date-time

    DirectoryDepartment:
      type: object
      required: [deptCode, deptName, status]
      properties:
        deptCode:
          type: string
        deptName:
          type: string
        parentDeptCode:
          type: string
          nullable: true
        deptPath:
          type: string
          nullable: true
        levelNo:
          type: integer
        sortOrder:
          type: integer
        managerUid:
          type: string
          nullable: true
        leaderUid:
          type: string
          nullable: true
        orgType:
          type: string
          enum: [department, committee, virtual]
        deptCategory:
          type: string
          nullable: true
        status:
          type: string
          enum: [active, inactive, deleted]
        children:
          type: array
          items:
            $ref: "#/components/schemas/DirectoryDepartment"

    DirectoryMembership:
      type: object
      required: [uid, deptCode, relationType, isPrimary, status]
      properties:
        uid:
          type: string
        deptCode:
          type: string
        relationType:
          type: string
          enum: [member, manager, leader, observer]
        isPrimary:
          type: boolean
        status:
          type: string
          enum: [active, inactive, deleted]

    DirectoryProject:
      type: object
      required: [projectCode, projectName, status]
      properties:
        projectCode:
          type: string
        parentProjectCode:
          type: string
          nullable: true
        projectName:
          type: string
        projectType:
          type: string
          enum: [group, project, template]
        deptCode:
          type: string
          nullable: true
        ownerUid:
          type: string
          nullable: true
        leaderUid:
          type: string
          nullable: true
        repoUrl:
          type: string
          nullable: true
        sourceProvider:
          type: string
        externalRef:
          type: string
          nullable: true
        status:
          type: string
          enum: [active, inactive, archived, deleted]
        updatedAt:
          type: string
          format: date-time

    SubjectExportItem:
      type: object
      required: [subjectType, subjectCode, sourceObjectType, sourceObjectCode, snapshotHash, status, exportedAt]
      properties:
        subjectType:
          type: string
          enum: [user, department, project]
        subjectCode:
          type: string
        externalRef:
          type: string
          nullable: true
        parentSubjectType:
          type: string
          nullable: true
          enum: [user, department, project]
        parentSubjectCode:
          type: string
          nullable: true
        sourceObjectType:
          type: string
          enum: [directory_users, directory_departments, directory_projects]
        sourceObjectCode:
          type: string
        snapshotHash:
          type: string
        status:
          type: string
          enum: [active, inactive, deleted]
        exportedAt:
          type: string
          format: date-time

    StartSyncJobRequest:
      type: object
      required: [providerCode, syncType, objectScope]
      properties:
        providerCode:
          type: string
          enum: [console, manual, account, ldap, wecom, dingtalk, gitlab]
          example: gitlab
        integrationCode:
          type: string
          nullable: true
        syncType:
          type: string
          enum: [full, incremental, manual]
        objectScope:
          type: string
          enum: [all, users, departments, projects, identities, subjects]
        cursor:
          type: string
          nullable: true
        dryRun:
          type: boolean
          default: false

    SyncJob:
      type: object
      required: [jobCode, providerCode, syncType, objectScope, status, createdAt]
      properties:
        jobCode:
          type: string
        providerCode:
          type: string
        syncType:
          type: string
        objectScope:
          type: string
        cursorBefore:
          type: string
          nullable: true
        cursorAfter:
          type: string
          nullable: true
        status:
          type: string
          enum: [pending, running, success, partial_success, failed, cancelled]
        totalCount:
          type: integer
        createdCount:
          type: integer
        updatedCount:
          type: integer
        deletedCount:
          type: integer
        skippedCount:
          type: integer
        errorCount:
          type: integer
        errorMessage:
          type: string
          nullable: true
        startedAt:
          type: string
          format: date-time
          nullable: true
        finishedAt:
          type: string
          format: date-time
          nullable: true
        createdAt:
          type: string
          format: date-time

    DirectoryMetaResponse:
      allOf:
        - $ref: "#/components/schemas/ApiEnvelope"
        - type: object
          properties:
            data:
              $ref: "#/components/schemas/DirectoryMeta"

    UserListResponse:
      allOf:
        - $ref: "#/components/schemas/ApiEnvelope"
        - type: object
          properties:
            data:
              allOf:
                - $ref: "#/components/schemas/CursorPage"
                - type: object
                  properties:
                    items:
                      type: array
                      items:
                        $ref: "#/components/schemas/DirectoryUser"

    UserDetailResponse:
      allOf:
        - $ref: "#/components/schemas/ApiEnvelope"
        - type: object
          properties:
            data:
              $ref: "#/components/schemas/DirectoryUser"

    UserBatchResponse:
      allOf:
        - $ref: "#/components/schemas/ApiEnvelope"
        - type: object
          properties:
            data:
              type: object
              required: [items, missingUids]
              properties:
                items:
                  type: object
                  additionalProperties:
                    $ref: "#/components/schemas/DirectoryUser"
                missingUids:
                  type: array
                  items:
                    type: string

    DepartmentListResponse:
      allOf:
        - $ref: "#/components/schemas/ApiEnvelope"
        - type: object
          properties:
            data:
              type: object
              required: [tree, flat]
              properties:
                tree:
                  type: array
                  items:
                    $ref: "#/components/schemas/DirectoryDepartment"
                flat:
                  type: array
                  items:
                    $ref: "#/components/schemas/DirectoryDepartment"

    DepartmentDetailResponse:
      allOf:
        - $ref: "#/components/schemas/ApiEnvelope"
        - type: object
          properties:
            data:
              $ref: "#/components/schemas/DirectoryDepartment"

    DepartmentMemberListResponse:
      allOf:
        - $ref: "#/components/schemas/ApiEnvelope"
        - type: object
          properties:
            data:
              allOf:
                - $ref: "#/components/schemas/CursorPage"
                - type: object
                  properties:
                    items:
                      type: array
                      items:
                        type: object
                        required: [user, membership]
                        properties:
                          user:
                            $ref: "#/components/schemas/DirectoryUser"
                          membership:
                            $ref: "#/components/schemas/DirectoryMembership"

    UserDepartmentListResponse:
      allOf:
        - $ref: "#/components/schemas/ApiEnvelope"
        - type: object
          properties:
            data:
              allOf:
                - $ref: "#/components/schemas/CursorPage"
                - type: object
                  properties:
                    items:
                      type: array
                      items:
                        $ref: "#/components/schemas/DirectoryMembership"

    ProjectListResponse:
      allOf:
        - $ref: "#/components/schemas/ApiEnvelope"
        - type: object
          properties:
            data:
              allOf:
                - $ref: "#/components/schemas/CursorPage"
                - type: object
                  properties:
                    items:
                      type: array
                      items:
                        $ref: "#/components/schemas/DirectoryProject"

    ProjectDetailResponse:
      allOf:
        - $ref: "#/components/schemas/ApiEnvelope"
        - type: object
          properties:
            data:
              $ref: "#/components/schemas/DirectoryProject"

    SubjectExportResponse:
      allOf:
        - $ref: "#/components/schemas/ApiEnvelope"
        - type: object
          properties:
            data:
              allOf:
                - $ref: "#/components/schemas/CursorPage"
                - type: object
                  properties:
                    items:
                      type: array
                      items:
                        $ref: "#/components/schemas/SubjectExportItem"

    SyncJobResponse:
      allOf:
        - $ref: "#/components/schemas/ApiEnvelope"
        - type: object
          properties:
            data:
              $ref: "#/components/schemas/SyncJob"
```

OpenAPI 约束：

- `subjects/export` 响应 schema 不允许出现 `displayName / realName / email / mobile / avatarUrl / deptName / projectName`。
- 业务应用默认只读 `users / departments / projects`，不直接调用 `sync-jobs`。
- `sync-jobs` 写接口只允许本地管理员或受信 service client 调用。
- 兼容 Account API 时，响应字段可做 adapter 映射，但底层数据源优先 `console.directory_*`。

### 5.5 Platform Subject Sync Pull API 鉴权与任务模型

结论：之前已在 MVP 方案中拍板，subject sync 的跨边界主链路采用 **Console 拉 Platform 任务 + Console 回传结果**，鉴权使用 Platform 签发给 Console 的租户级 runtime token。Platform 不把客户侧 Console Directory API 作为主同步入口直接调用，避免 SaaS 控制面直连企业内网。

#### 5.5.1 两类 API 的鉴权边界

| API | 调用方向 | 鉴权方式 | 用途 |
|-----|----------|----------|------|
| Platform runtime `subject-sync/pull` | Console -> Platform | `Authorization: Bearer hzy_rt_...` | Console 拉取待执行的 subject sync 任务 |
| Platform runtime `subject-sync/push` | Console -> Platform | `Authorization: Bearer hzy_rt_...` | Console 回传最小 subject 投影，同步到 `platform.tenant_subjects` |
| Console Directory `GET /api/v1/console/directory/subjects/export` | Console 本地 worker / 同部署受信服务 -> Console | `AdminSession` 或 `ServiceCredential` | 从 Console 本地目录库读取最小 subject 投影 |

约束：

- Platform runtime token 存于 Platform `tenant_runtime_credentials`，Platform 只保存 hash，明文只在开通/轮换时下发给 Console。
- Console Directory `ServiceCredential` 是企业侧内部服务凭证，来源于 Console 本地 `service_clients / service_client_credentials`，不等同于 Platform runtime token。
- SaaS Platform 不直接持有 Console Directory `client_secret`，也不要求客户侧开放 `subjects/export` 给公网 Platform 调用。
- `subjects/export` 是 Console 内部数据投影 API；真正跨边界同步以 Platform runtime `pull/push` 为合同。

#### 5.5.2 Platform 任务模型

Platform 侧新增 `subject_sync_tasks` 逻辑模型，MVP 字段：

| 字段 | 说明 |
|------|------|
| `task_id` | 全局唯一任务 ID |
| `tenant_code` | 租户编码 |
| `deployment_code` | 目标 Console deployment |
| `sync_mode` | `full` 或 `incremental` |
| `subject_type` | 可空；为空表示 `user / department / committee / project` 全部 |
| `cursor` | 上次同步游标或分页游标 |
| `changed_after` | 增量同步起点 |
| `status` | `pending / claimed / running / succeeded / failed / canceled / expired` |
| `claimed_by` | Console deployment code |
| `claimed_at` | Console 拉取并声明任务时间 |
| `requested_by` | ops 触发人或 `system` |
| `requested_at` | 任务创建时间 |
| `started_at` / `finished_at` | 实际执行时间 |
| `total_count / success_count / failed_count` | 结果统计 |
| `error_message` | 失败摘要 |

MVP 可以先把该模型落在 Platform 数据库表，也可以先用现有 onboarding step / audit 表承载状态；但对外 API 必须按任务模型返回。

#### 5.5.3 Runtime API 合同

Platform 对 Console 暴露两个 runtime 接口：

```text
GET  /api/v1/runtime/deployments/{deploymentCode}/subject-sync/pull
POST /api/v1/runtime/deployments/{deploymentCode}/subject-sync/push
```

兼容期可保留旧路径：

```text
GET  /api/platform/runtime/deployments/{deploymentCode}/subject-sync/pull
POST /api/platform/runtime/deployments/{deploymentCode}/subject-sync/push
```

`pull` 行为：

1. 校验 `Authorization: Bearer hzy_rt_...`。
2. 通过 token 解析 `tenant_code`，校验 `deploymentCode` 属于该租户。
3. 查找 `pending` 或已超时可重试的任务。
4. 原子 claim：写 `claimed_by / claimed_at / status=claimed`。
5. 返回任务与游标；无任务时返回 `204 No Content` 或 `{ task: null }`。

`push` 行为：

1. 校验同一 runtime token 和 deployment 归属。
2. 校验 `task_id` 属于该 `tenant_code + deploymentCode`。
3. 校验 payload 只包含最小字段。
4. 幂等 upsert `tenant_subjects(tenant_code, subject_type, subject_code)`。
5. 按 `external_ref / parent / status` 更新平台最小主体目录。
6. 更新任务统计、游标和最终状态。

#### 5.5.4 Payload 最小字段

Console 回传 Platform 的 subject item 只允许：

```ts
type SubjectSyncItem = {
  subjectType: 'user' | 'department' | 'committee' | 'project'
  subjectCode: string
  externalRef?: string | null
  parentSubjectType?: 'department' | 'committee' | 'project' | null
  parentSubjectCode?: string | null
  status: 'active' | 'inactive' | 'deleted'
  snapshotHash?: string
}
```

禁止字段：

- `displayName`
- `realName`
- `email`
- `mobile`
- `avatarUrl`
- `deptName`
- `projectName`
- 任何 provider 原始 profile payload

Platform handler 必须做 allowlist 过滤；出现禁止字段时直接 `400 DIR_SUBJECT_PII_FORBIDDEN`，不能静默入库。

#### 5.5.5 Console Worker 执行模型

Console `subjectSync.worker` 默认每 5 分钟执行：

1. 调 Platform `pull` 获取任务。
2. 如无任务则退出。
3. 读取 Console 本地 `directory_subject_exports`，分页大小默认 500。
4. 每页调用 Platform `push`，携带 `task_id / cursor / items / has_more`。
5. Platform 返回下一游标或任务完成状态。
6. Console 记录本地执行日志，并在下一轮继续未完成任务。

手动触发入口：

```text
POST /api/subject-sync/run
```

该入口只在 Console 本地管理面使用，用于立即执行一次 worker；它不绕过 Platform runtime token，也不直接写 Platform 数据库。

#### 5.5.6 失败与重试

| 场景 | 处理 |
|------|------|
| Platform `pull` 返回 401/403 | 停止同步，标记 runtime token 无效，提示重新下发/轮换 |
| Platform 临时 5xx / 网络失败 | 指数退避重试，不清空本地 cursor |
| 单页 `push` 部分失败 | Platform 返回失败 item 列表；Console 可重推该页或标记任务 failed |
| 任务 claim 后长期无回传 | Platform 将任务从 `claimed/running` 标记为 `expired`，允许重新 pull |
| PII 字段被拒绝 | 任务 failed，必须修复 Console export allowlist 后重跑 |

#### 5.5.7 和 Console Directory API 的关系

- `GET /api/v1/console/directory/subjects/export` 是 Console 内部最小投影读取接口。
- Platform 不依赖该接口的 Basic credential 直连客户侧 Console。
- Console worker 可以直接读表，也可以通过该接口读投影；如果通过接口读，鉴权用 Console 本地 `ServiceCredential`。
- Foundation directory adapter 的 `ServiceCredential` 只服务同部署业务应用访问 Console Directory，不参与 Platform runtime 鉴权。

### 5.6 登录 / Session Cookie 兼容策略

目标：Console 接管企业端登录与 session 后，不要求所有业务应用一次性改造；迁移期继续兼容现有 `token + auth_user` 判断，目标态统一由 Console `local_sessions` 做服务端校验。

#### 5.6.1 Cookie 分层

| Cookie | 阶段 | 读写方 | 用途 | 约束 |
|--------|------|--------|------|------|
| `console_session` | 目标主 cookie | Console 写，Console / Foundation server 读 | Console 本地 session ID，对应 `local_sessions.session_id` | 目标态 `HttpOnly + SameSite=Lax`，HTTPS 下 `Secure` |
| `token` | 迁移兼容 cookie | Console 双写，旧应用读 | 兼容现有 Foundation `useAuthState()` 和各应用前端守卫 | 迁移期可读；切到 server auth bridge 后改为 HttpOnly 或停止写入 |
| `auth_user` | 迁移兼容 cookie | Console 双写，旧应用读 | 兼容旧应用识别当前 uid | 只能作为显示/兼容字段，不能单独作为授权依据 |
| `auth_email` / `auth_realname` / `auth_nickname` / `auth_avatar` / `auth_department` / `auth_dept_code` / `auth_mobile_tail4` | 迁移兼容显示 cookie | Console 双写，旧应用读 | 兼容旧 UI 展示用户资料 | 不参与授权；后续由 `/api/v1/console/auth/me` 替代 |
| `wecom_checked` | 登录循环保护 | Console / Foundation 写 | 防止企业微信内置浏览器反复自动跳转 | 短 TTL，仅用于客户端跳转控制 |

原则：

- 新能力只信任 `console_session` 对应的 `local_sessions` 记录。
- `token` 在双写阶段是兼容别名，不再表示 Account 的远端 session。
- `auth_*` 是前端展示缓存，允许被用户篡改，服务端不得用它们做权限判断。
- 新增接口默认从服务端 session 解析 uid，再读取 `directory_users / directory_identities`。

#### 5.6.2 写入策略

Console 登录回调统一落到本地 auth-runtime：

1. CAS / WeCom / OIDC / 本地登录回调解析外部身份。
2. 通过 `directory_identities(provider_code, provider_subject)` 找到 `uid`。
3. 校验 `directory_users.status = active`。
4. 生成高强度随机 `session_id`，写入 `local_sessions`。
5. 写入 `auth_login_events`，记录 `target_app / auth_provider / login_type / session_id / ip_address`。
6. 写 `console_session=session_id`。
7. 在 `CONSOLE_AUTH_COOKIE_MODE=dual` 阶段同步写旧 cookie：`token=session_id`、`auth_user=uid` 和必要 `auth_*` 展示字段。

不建议把 CAS ticket、WeCom code 或 Account 旧 token 直接存为 `local_sessions.session_id`。这些值的生命周期、长度、泄露面都不受 Console 控制；Console 应始终生成自己的本地 session ID。

#### 5.6.3 读取与校验顺序

服务端统一封装 `requireConsoleSession(event)`：

1. 优先读取 `console_session`。
2. 若缺失且 `AUTH_LEGACY_COOKIE_FALLBACK=true`，读取 `token` 作为迁移期兼容入口。
3. 用 session ID 查询 `local_sessions`，要求 `status=active`、`expires_at > NOW()`、`revoked_at IS NULL`。
4. 关联 `directory_users`，要求用户仍为 `active`。
5. 更新 `last_seen_at`，返回 `{ uid, sessionId, user, identity }`。

客户端短期继续用 `token + auth_user` 维持路由守卫，避免业务应用统一改造；中期 Foundation 新增 `/api/v1/console/auth/me` adapter 后，前端应以该接口结果为准，不再直接判断 cookie。

#### 5.6.4 登出与吊销

Console 登出接口统一处理：

1. 读取并吊销当前 `local_sessions`，设置 `status=revoked`、`revoked_at=NOW()`。
2. 清理 `console_session`。
3. 清理全部兼容 cookie：`token`、`auth_user`、`auth_email`、`auth_role`、`auth_realname`、`auth_real_name`、`real_name`、`auth_nickname`、`auth_avatar`、`auth_department`、`auth_dept_code`、`auth_mobile_tail4`。
4. 如需避免企业微信循环自动登录，可短期写入 `wecom_checked=1`。
5. CAS 模式下按配置跳转 CAS logout；非 CAS 模式回到 Console `/login`。

吊销必须以 `local_sessions` 为准。仅清 cookie 不能视为服务端登出。

#### 5.6.5 Cookie 域与安全参数

| 场景 | domain | secure | sameSite |
|------|--------|--------|----------|
| 本地开发 `localhost / 127.0.0.1` | 不设置 domain | false | `lax` |
| 同一根域多应用，如 `*.wiztek.cn` | 根域，如 `.wiztek.cn` | true | `lax` |
| 跨站嵌入或 iframe | 单独评估 | true | `none`，但需要 CSRF 保护 |

实现要求：

- 继续复用 Foundation `getAuthCookieOptions()` / `useCookieOptions()` 计算 domain/path，避免各模块 cookie 域不一致。
- `console_session` 目标态必须 `HttpOnly`；双写期由于旧前端仍读取 `token`，`token` 暂时保持可读。
- HTTPS 环境必须启用 `Secure`。
- Session TTL 建议通过 `AUTH_SESSION_TTL_SECONDS` 配置，默认 24 小时；如支持“记住我”，用单独 `AUTH_REMEMBER_TTL_SECONDS`，不要无限期 cookie。

#### 5.6.6 迁移开关

| 配置 | 默认 | 含义 |
|------|------|------|
| `CONSOLE_AUTH_COOKIE_MODE` | `dual` | `legacy` 只写旧 cookie；`dual` 双写；`console` 只写 `console_session` |
| `AUTH_LEGACY_COOKIE_FALLBACK` | `true` | `console_session` 缺失时是否接受 `token` 兼容 |
| `AUTH_COOKIE_DOMAIN` | 空 | 显式覆盖 cookie domain；为空时按请求 host 推导 |
| `AUTH_COOKIE_SECURE` | `auto` | `auto / true / false` |
| `AUTH_SESSION_TTL_SECONDS` | `86400` | 普通 session TTL |
| `AUTH_REMEMBER_TTL_SECONDS` | `604800` | 记住登录 TTL |

#### 5.6.7 分阶段落地

| 阶段 | 行为 | 退出条件 |
|------|------|----------|
| Phase 4A：双写兼容 | Console 回调创建 `local_sessions`，同时写 `console_session` 和旧 `token/auth_user/auth_*` | 旧应用无需改造即可登录 |
| Phase 4B：Foundation server auth bridge | Foundation 增加 `/api/v1/console/auth/me` 读取 Console session，`useAuth` 优先使用接口结果，cookie 只作启动缓存 | 主要业务应用不再直接依赖 `auth_*` |
| Phase 4C：Console 登录入口主切 | 应用未登录统一跳 Console `/login` 或 `/api/auth/*`，Account 登录接口只做 redirect / facade | 新登录链路不再依赖 Account |
| Phase 4D：旧 cookie 退场 | `CONSOLE_AUTH_COOKIE_MODE=console`，停止写展示型 `auth_*` cookie，`token` 停写或改为 HttpOnly alias | 调用审计无旧 cookie 依赖 |

#### 5.6.8 实现清单

- Console 新增 `server/utils/session.ts`：生成 session、校验 session、刷新 `last_seen_at`、吊销 session、统一写/清 cookie。
- Console 登录回调从“直接写 legacy cookie”改为“创建本地 session 后双写 cookie”。
- Console 新增 `/api/v1/console/auth/me`，返回当前用户最小资料和能力摘要。
- Console 新增 `/api/v1/console/auth/logout`，服务端吊销 session 并清理 cookie。
- Foundation 新增 auth adapter：优先调 Console `/auth/me`，失败时按开关 fallback legacy cookies。
- 业务模块逐步移除直接读取 `auth_*` 做授权的逻辑。

### 5.7 Account 管理页面迁移盘点

本节基于当前 `account/app/pages/admin/*.vue` 与 `console` 目标边界梳理。迁移原则：

- 目录、企业本地配置、外部目录源同步、服务凭证、登录/session、企业侧审计迁入 `console`。
- 应用注册、资源动作、跨应用角色授权、订阅/部署治理迁入 `platform`。
- Account 迁移期只做一次性迁移源和旧版本兼容 facade，不再新增管理页面能力。

#### 5.7.1 必须迁入 Console 的页面

| Account 页面 | 当前职责 | Console 目标页面 / 子域 | 迁移优先级 | 处理说明 |
|--------------|----------|-------------------------|------------|----------|
| `/admin/users` | 用户目录、LDAP 同步、企业微信绑定、用户编辑 | `/directory/users` + `/directory/sync` | P0 | 对应 `directory_users / directory_identities / directory_sync_jobs`；同步动作改走 Console directory-runtime |
| `/admin/departments` | 部门树、委员会、成员/负责人维护 | `/directory/departments` | P0 | 对应 `directory_departments / directory_user_departments`；保留委员会/特殊组织节点能力 |
| `/admin/dingtalk` | 钉钉部门/用户读取、邮箱生成、绑定 | `/integrations/dingtalk` + `/directory/sync` | P0 | 凭证进入 `integrations + vault`，同步结果进入 `directory_*` |
| `/admin/git-projects` 的注册表部分 | 项目/项目组、负责人、部门、成员 | `/directory/projects` + `/directory/sync` | P1 | 项目注册表已通过 Console `gitlab` sync provider 写入 `directory_projects / directory_project_members`；GitLab fork、文档同步、冲突处理不属于 directory-runtime 核心 |
| `/admin/logs` | 登录日志、操作日志、在线用户 | `/auth/logs` + `/audit/logs` + `/sessions` | P1 | 对应 `auth_login_events / operation_logs / local_presence_heartbeats / local_sessions` |
| `/admin/company` | 企业资料、Logo、行业、联系人 | `/org-profile` | P0 | Console 已有 `org_profiles`；需补齐 Account 页面字段映射 |
| `/admin/business-domains` | 企业业务领域配置 | `/org-profile/business-domains` 或 `/system-settings/business-domains` | P1 | Console DDL 已有 `org_business_domains` |
| `/admin/regions` | 区域、行政区划映射 | `/org-profile/regions` 或 `/system-settings/regions` | P1 | Console DDL 已有 `regions / region_divisions` |
| `/admin/apis` | API key 管理 | `/service-clients` | P0 | 迁为 `service_clients / service_client_credentials`，secret 入 `vault`，旧 API key 接口仅兼容 |
| `/admin/profile` | 管理员个人资料、密码 | `/settings/profile` + Console auth-runtime | P1 | 与普通 `/profile`、`/password` 合并，不保留 admin 专用副本 |

#### 5.7.2 不应整体迁入 Console 的页面

| Account 页面 | 目标去向 | 原因 | Console 仅保留的部分 |
|--------------|----------|------|----------------------|
| `/admin/apps` | `platform` 应用注册、部署、订阅、入口治理 | 应用目录和可见性属于控制面治理，不应由企业侧目录运行时决定 | 可读取 Platform 下发的应用入口展示策略；不存 Platform app secret |
| `/admin/resources` | `platform` manifest resource/actions | 资源动作是 policy bundle 输入，应随应用 manifest 与平台授权模型治理 | 无；最多展示只读授权摘要 |
| `/admin/roles` | `platform` 租户角色、模板、subject 授权 | 跨应用授权和角色裁决属于 Platform；Console 只提供 subject 目录 | Console 可有本地管理面角色，但不能复刻 Account 跨应用 RBAC |

#### 5.7.3 需要拆分后迁移的页面

| Account 页面 | 拆分项 | 去向 |
|--------------|--------|------|
| `/admin/git-projects` | 项目注册表、项目成员、部门归属 | Console `directory_projects / directory_project_members` |
| `/admin/git-projects` | GitLab 同步、fork 创建、模板 fork、文档同步/冲突处理 | GitLab integration、Aims、Codocs 或独立 Git supporting service |
| `/admin/users` | 用户主数据、部门关系、外部身份绑定 | Console directory-runtime |
| `/admin/users` | LDAP / 企业微信 / 钉钉同步配置与凭证 | Console integrations + vault |
| `/admin/logs` | 登录日志、在线状态 | Console auth-runtime |
| `/admin/logs` | 跨应用业务操作日志聚合 | Console audit 只做本地聚合；应用侧详细审计仍由各业务应用负责 |

#### 5.7.4 非管理入口的迁移

| Account 页面 | 目标去向 | 说明 |
|--------------|----------|------|
| `/login` | Console `/login` | Console 接管 CAS / WeCom / OIDC / 本地登录回调 |
| `/profile` | Console `/settings/profile` | 读取 `directory_users` 与当前 `local_sessions` |
| `/password` | Console auth-runtime | 仅本地密码模式需要；SSO 模式展示“由外部 IdP 管理” |
| `/myapps` | Platform tenant app launcher 或 Console 首页读取 Platform 应用入口 | 应用可见性不再来自 Account applications |
| `/messages/redirect` | Console WeCom integration 或 Foundation notify helper | 仅保留企业微信内置浏览器跳转兼容能力 |

#### 5.7.5 Console 目标导航建议

第一阶段 Console 管理面建议新增：

- `目录 / 用户`
- `目录 / 部门`
- `目录 / 项目注册表`
- `目录 / 同步任务`
- `身份 / 登录日志`
- `身份 / 在线会话`
- `集成 / LDAP`
- `集成 / 企业微信`
- `集成 / 钉钉`
- `企业 / 业务领域`
- `企业 / 区域`
- `开发者 / 服务客户端`
- `审计 / 操作日志`

不建议在 Console 新增：

- `应用管理`
- `资源管理`
- `跨应用角色管理`

这些应落在 Platform 或由 Console 只读展示 Platform 下发的治理结果。

---

## 6. 实施阶段

### Phase 0：口径与开关

目标：先把运行方式定死，避免边做边改方向。

任务：

- 更新架构文档，明确 `console.directory-runtime` 是目标权威源。
- 在 `console` 增加 runtimeConfig：`directory.mode = disabled | primary`。
- 在 Foundation 增加目录来源配置：`HZY_DIRECTORY_PROVIDER=console`。
- 新接入目录 adapter 的业务应用必须配置 `HZY_CONSOLE_API_URL`。
- 未接入新 adapter 的存量应用可临时保持原有 Account 调用，但 Foundation 新能力不提供 Account fallback。

验收：

- 文档、env 模板和 CLAUDE 说明一致。
- 新目录 adapter 配置缺失时 fail fast，不静默回 Account。

### Phase 1：Console 目录只读镜像

状态：进行中，已完成 Console Directory Runtime 只读 API、Account 兼容 facade、目录用户/部门/项目注册表只读管理页、Directory Sync Job 最小框架、LDAP / 企业微信 / 钉钉目录源配置层、LDAP / 企业微信 / 钉钉 provider runner，以及同步任务详情/事件查看；目录写操作与 provider 字段映射增强待迁移。


目标：把 Account 目录数据复制到 Console，但不切流量。

任务：

- 在 `console` 新增 `directory_*` 表。
- 实现一次性导入脚本：Account → Console，脚本见 `docs/Console-SQL-Migration-v1-account-to-directory.sql`。
- 实现增量同步任务框架。
- 实现 Console Directory API 只读接口。
- 实现 `/api/v1/console/directory/subjects/export` 最小 subject 投影。

验收：

- Console 可返回用户、部门、项目注册表。
- 与 Account 对账 hash 一致。
- subject export 不包含 PII。

### Phase 2：Foundation 直接接入 Console

目标：业务模块通过 Foundation 直接读取 Console Directory API，不再做 Account 双读与 shadow compare。

任务：

- Foundation directory adapter 只实现 Console provider。
- 业务模块配置 `HZY_DIRECTORY_PROVIDER=console` 与 `HZY_CONSOLE_API_URL`。
- 业务模块新增 `/api/directory/**` 薄代理，旧 `/api/account/**` 若保留名称也必须改为调用 Console adapter。
- 修正 Console Directory API 字段映射差异。
- 移除新增代码中的 `HZY_ACCOUNT_API_*` 依赖。

进展：

- Foundation 已提供 `/api/directory/**` 薄代理，统一委托 `server/utils/directoryApi.ts` 调 Console Directory Runtime。
- Foundation 已新增 `useDirectory*()` 与 `useDirectoryStore()`；旧 `useAccount*()` / `useAccountStore()` 保持签名不变，内部委托新目录层。
- Foundation 的 `UserTreeSelector` 与 `UserMenu` 已改读 `/api/directory/**`。
- Console 自身的 `/api/user/applications` 已不再代理 Account，改为读取 Platform runtime 应用入口，并用本地 policy bundle 过滤当前用户可见应用。
- Platform policy bundle 的 `applications` 投影已包含 `description/icon/homeUrl/callbackUrl/logoutUrl`，Console 在 Platform 临时不可达时也能从本地 bundle 展示应用入口，并可物化 OIDC `auth_clients` 与 redirect/logout URI。
- Console 启动时同步资源到 Account 的旧插件已删除；应用资源与角色授权由 Platform manifest / system roles / policy bundle 承接。

验收：

- 主要业务页面目录数据来自 Console。
- Console 目录 API 覆盖业务应用实际使用字段。
- 停止 Account 后，已迁移业务页面仍可读取用户、部门、项目注册表。

### Phase 3：Account 目录依赖清理

目标：清理业务模块对 Account 目录 API 的运行时依赖，Account 只作为迁移源或旧版本兼容服务。

任务：

- 删除业务模块 env 模板中的 `HZY_ACCOUNT_API_URL / HZY_ACCOUNT_API_KEY / HZY_ACCOUNT_API_SECRET` 新依赖。
- 将 `useAccount*`、`stores/account` 的新调用迁到 `useDirectory*`、`stores/directory`。
- 对仍保留的 `/api/account/**` 兼容路由加 deprecated 日志。
- 更新 console service client 权限，确保业务应用可访问目录 API。

验收：

- Aims 使用 Console 获取目录。 Codocs / Altoc / Assets / Align / Insights 延后处理。
- Account 停机演练时，已迁移页面仍可用。
- 新代码不再新增 Account 目录 API 调用。

### Phase 3.5：Account 管理页迁移到 Console

目标：把租户侧目录运营和企业本地配置页面迁到 Console，避免目录数据已经切到 Console 但管理员仍必须进入 Account 操作。

任务：

- 新增 Console 目录管理导航：用户、部门、项目注册表、同步任务。
- 迁移 `/admin/users`、`/admin/departments`、`/admin/dingtalk`、`/admin/apis`、`/admin/company` 的 P0 页面能力。
- 补齐企业微信、LDAP、钉钉集成配置页，凭证统一写入 `integrations + vault`。
- 迁移 `/admin/logs` 中的登录日志、在线会话、操作日志查看能力。
- 迁移 `/admin/business-domains`、`/admin/regions` 到企业资料或系统设置子页。
- 拆分 `/admin/git-projects`：项目注册表进 Console，GitLab fork/文档同步/冲突处理移出 directory-runtime。
- 明确 `/admin/apps`、`/admin/resources`、`/admin/roles` 不迁 Console，改由 Platform 承接或只读展示 Platform 治理结果。
- Account 对应页面加 deprecated 标识，稳定后跳转到 Console 或 Platform 新入口。

验收：

- 租户管理员可在 Console 完成用户、部门、项目注册表、目录同步、企业资料、服务客户端和日志查看。
- Account 停机演练时，已迁移的管理动作可在 Console 完成。
- Console 中不存在新的跨应用资源/角色授权编辑入口。
- GitLab 文档同步、fork 创建等业务动作不混入 Console directory-runtime。

### Phase 4：Auth Runtime 迁移

目标：本地登录/session 从 Account 收敛到 Console。

任务：

- Console 接管 CAS / WeCom / OIDC 登录回调，回调不再只写 legacy cookie，而是先创建 `local_sessions`。
- 外部身份映射落入 `directory_identities`，登录时按 `provider_code + provider_subject` 解析 `uid`。
- 新增 `CONSOLE_AUTH_COOKIE_MODE=dual` 双写策略，同时写 `console_session` 与 legacy `token/auth_user/auth_*`。
- 新增 Console session server util，统一完成 session 生成、校验、`last_seen_at` 刷新和吊销。
- 新增 `/api/v1/console/auth/me`，供 Foundation 和业务前端读取当前用户最小资料。
- 新增 `/api/v1/console/auth/logout`，吊销 `local_sessions` 并清理新旧 cookie。
- Foundation `useAuth` 与 server auth bridge 优先改读 Console session，迁移期开启 legacy cookie fallback。
- Account 登录接口保留重定向或兼容代理，但不再作为新 session 权威源。

验收：

- 业务应用登录链路不依赖 Account。
- 用户 cookie/session 语义稳定。
- 登录审计落 Console，并可按需上报 coarse audit 到 Platform。
- 切换到 `CONSOLE_AUTH_COOKIE_MODE=dual` 后，旧应用仍可通过 `token + auth_user` 正常访问。
- 服务端权限判断只接受已校验的 `local_sessions`，不信任 `auth_*` 展示 cookie。

进展：

- Console CAS / WeCom 登录回调的审计写入已改为本地 `auth_login_events`，不再调用 Foundation Account API 的 `reportLoginAudit`。
- Console Auth Runtime Phase 1 已落地：CAS / WeCom 回调会先创建 `local_sessions`，再按 `CONSOLE_AUTH_COOKIE_MODE=dual` 双写 `console_session` 与 legacy `token/auth_user/auth_*`；已新增 `/api/v1/console/auth/me` 与 `/api/v1/console/auth/logout`，服务端权限入口已改为读取已校验的 Console session。

### Phase 5：Platform subject sync 改为 Console 拉任务并回传

目标：platform 不再接收企业端主动无任务推送，也不直连企业内网读取目录；Console 使用 runtime token 拉取 Platform 任务，读取本地最小投影后回传 Platform。

任务：

- Platform 提供 `subject-sync/pull` 与 `subject-sync/push` runtime API，统一用 `Authorization: Bearer hzy_rt_...` 鉴权。
- Console `subject_sync` worker 定时拉取任务，读取本地 `directory_subject_exports`。
- Console 回传只包含 `subject_type / subject_code / external_ref / parent / status / snapshot_hash`。
- Platform 幂等 upsert `tenant_subjects`。
- 添加同步状态和延迟指标到 deployment heartbeat。

验收：

- Platform `tenant_subjects` 可由 Console worker 自动维护。
- 不传姓名、邮箱、手机等 PII。
- 断联后恢复能自动追平。

### Phase 6：Account 下线或转 facade

目标：减少企业端必选服务数量。

任务：

- Account API 由 Console facade 提供。
- 独立 Account 服务标记 deprecated。
- 清理业务应用直接 Account 调用。
- 保留数据迁移与回滚工具。

验收：

- 新部署不再需要独立 Account 服务。
- 老部署可选择继续运行 Account 或迁移到 Console。
- 文档和 env 模板不再把 `HZY_ACCOUNT_API_*` 作为新模块必填项。

---

## 7. 回滚策略

每个阶段必须可回滚：

| 阶段 | 回滚方式 |
|------|----------|
| Phase 1 | 停止 Console 同步任务，业务仍走 Account |
| Phase 2 | 回滚业务模块到未接入 Foundation directory adapter 的上一版本 |
| Phase 3 | 保留旧 `/api/account/**` 兼容路由，短期回退到上一版业务模块 |
| Phase 4 | `CONSOLE_AUTH_COOKIE_MODE=legacy`，`AUTH_LEGACY_COOKIE_FALLBACK=true`，登录入口切回 Account |
| Phase 5 | Platform subject sync 暂停，保留既有 subject 快照 |
| Phase 6 | 继续部署独立 Account |

---

## 8. 风险与处理

| 风险 | 影响 | 处理 |
|------|------|------|
| Console 职责膨胀 | 企业端基础服务变大，故障影响更广 | 按 domain 分层，目录、vault、settings、auth 独立目录和 API |
| 目录 PII 与 vault 同库 | 合规和安全边界更集中 | 严格 RBAC、审计、字段脱敏、secret 与目录表权限隔离 |
| 旧客户端未迁移 | 旧应用迁移失败 | 先做调用审计，按实际字段补 Console 兼容响应 |
| 目录同步失败影响登录 | 用户无法访问应用 | 保留本地缓存、增量同步、重试、管理员紧急账号 |
| Platform subject sync 泄露 PII | 合规风险 | export 表和 API 强制最小字段，测试覆盖禁止字段 |

---

## 9. 验收标准

第一阶段完成标准：

- Console 有只读目录 API。
- Console 可从 Account 导入并同步用户、部门、项目注册表。
- Foundation 可配置 `HZY_DIRECTORY_PROVIDER=console` 并从 Console 读取目录。
- Platform 可通过 Console worker 回传维护最小 subject 目录。
- 新增文档说明业务应用不得直连 Account 内部表。

最终完成标准：

- 新企业部署只需要 `platform`、`console` 和选购业务应用，不再必选独立 `account` / `workflow`。
- 业务应用目录读取统一走 Foundation directory adapter。
- Console 可独立完成企业端登录、目录同步、目录查询、subject export。
- Account 可下线，或保留为兼容 facade，不再承载新目录能力。

---

## 10. 待补设计

后续需要单独细化：暂无。
