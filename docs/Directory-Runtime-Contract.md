# Directory Runtime 契约 v1

状态：Draft  
日期：2026-04-23  
定位：目标设计，作为 `Huizhi-yun-Platform-Target-Architecture.md`、`HZY-Platform-SQL-DDL-Draft-v2.sql` 与 `Control-Plane-API-Contract.md` 的配套文档

配套迁移清单：`Console-Directory-Runtime-Integration-Plan.md`、`Account-Directory-Runtime-Refactor-Plan.md`

---

## 0. 文档目标

本文档定义客户侧 `directory-runtime` 的标准契约，回答三个问题：

- 目录服务由谁承载，平台管到什么程度
- 业务应用通过什么标准接口读取用户、部门、项目注册表
- 目录服务如何向平台上报版本、契约兼容性和同步健康

本文档只定义：

- 目录服务的职责边界
- 平台治理面
- 业务读取 API 契约
- 同步摘要与 heartbeat 契约

本文档不展开：

- 目录服务内部表结构
- 不同 IdP / LDAP / 钉钉 / 企业微信的适配细节
- 具体 SDK 代码实现

---

## 1. 定位

`directory-runtime` 是**客户侧部署、平台治理**的组织目录服务。

它的职责是：

- 承接客户侧全量组织目录明细
- 向业务模块提供统一的用户、部门、项目注册表查询接口
- 通过标准 heartbeat 向平台上报契约版本、快照摘要和同步健康

它**不是**平台数据库的一部分，也**不是**平台保存通讯录明细的入口。

一句话：

**平台治理 directory-runtime，业务模块消费 directory-runtime，组织目录明细仍留在客户侧。**

---

## 2. 参与方

### 2.1 Platform

负责：

- 应用注册与 manifest 审核
- deployment / license / credential / connectivity / heartbeat 治理
- 判断目录契约是否兼容、同步是否健康

不负责：

- 保存用户、部门、项目注册表明细
- 直接向业务模块提供高频目录查询

### 2.2 Directory Runtime

负责：

- 对接 LDAP / CAS / OIDC / 企业微信 / 钉钉 / HR 系统等上游源
- 物化本地目录读模型
- 对业务模块提供稳定目录 API
- 向平台上报目录契约版本与同步摘要

### 2.3 Business Applications

如 `aims / codocs / altoc / assets / align / workflow`。

只通过标准目录 API 读取：

- 用户
- 部门
- 成员关系
- 项目注册表

不得直接依赖目录服务内部表结构。

### 2.4 Foundation Adapter

Foundation 负责：

- 把当前 `useAccount*()` 的消费面逐步抽象到 `directory-runtime`
- 封装目录服务鉴权、重试与缓存
- 为业务模块保留稳定调用方式

### 2.5 Current `account` Module

在迁移阶段，当前 `account` 模块是目录事实源、兼容 API 和迁移源；目标实现载体是 `console` 内的 `directory-runtime` 逻辑域。

这意味着：

- 短中期内保留现有 `account` 服务和管理页面
- 但其架构角色收敛为“迁移期目录服务兼容层”
- 新目录能力优先落到 `console.directory-runtime`
- 平台控制面账户、订阅、授权、License 不再继续沉积到 `account`
- 迁移完成后，业务应用应通过 Foundation directory adapter 访问 console，而不是直连 account

---

## 3. 设计原则

| # | 原则 |
|---|------|
| D1 | 目录明细留在客户侧，平台只看摘要 |
| D2 | 目录服务是受管 runtime，不是自由实现的黑盒 |
| D3 | 业务模块只能通过标准 API 读目录，不得绕过契约 |
| D4 | 稳定标识优先：`uid / dept_code / project_code` |
| D5 | 平台只接收 contract/version/hash/cursor/count/lag，不接明细 |
| D6 | 业务显示字段允许本地缓存与分钟级延迟，鉴权稳定键必须一致 |

---

## 4. 平台治理面

`directory-runtime` 在平台模型中有两种表示：

目标表示：

- 作为 `console` manifest 内的 `directory-runtime` capability / API contract。
- 跟随 `console` 的 `subscriptions + deployments` 进入租户。
- 通过 `console` deployment heartbeat 上报目录契约与同步摘要。
- 通过 `deployment_connectivity_checks` 对 console 的目录 API 做契约检查。

兼容表示：

- 如历史部署仍保留独立目录服务，可用 `platform_applications.service_role = 'directory_runtime'` 表示。
- 独立 `directory-runtime` deployment 只用于迁移期，不作为新部署默认形态。

平台治理的对象包括：

- manifest 版本
- API 契约版本
- deployment 存活状态
- 同步游标和 lag
- 目录规模摘要
- license / capability / revocation

平台**不治理**以下内容：

- 某个员工的邮箱或手机号是什么
- 某个部门下有哪些人
- 某个项目的业务属性明细

租户侧仍需要目录管理入口，但这个入口属于 `console.directory-runtime` 的管理面；迁移期可继续由 `account` 页面承载，而不是平台托管目录明细：

- 数据源接入配置
- 同步策略和重同步
- 字段映射和组织映射
- 异常记录、冲突处理、手工校正
- 目录范围与可见性配置

---

## 5. 业务侧标准 API

Base URL 建议：

- 目标本地侧：`http://console/api/v1/directory` 或 `http://console/api/v1/console/directory`
- 独立进程兼容侧：`http://directory-runtime/api/v1/directory`
- 业务模块通过 Foundation 代理后可表现为：`/api/directory/**`

认证建议：

- 业务模块到目录服务使用本地 service credential
- 短期迁移阶段可兼容当前 `Authorization: Bearer {api_key}:{api_secret}` 风格
- 不建议复用用户 token 做服务间目录查询

### 5.1 `GET /api/v1/directory/meta`

用途：

- 返回目录服务自身的契约版本与健康摘要

响应建议：

```json
{
  "code": 0,
  "data": {
    "serviceRole": "base_runtime",
    "appCode": "console",
    "capability": "directory_runtime",
    "contractVersion": "dir.v1",
    "snapshotHash": "sha256_xxx",
    "syncCursor": "cursor_20260423_001",
    "userCount": 1280,
    "departmentCount": 42,
    "projectCount": 166,
    "syncLagSeconds": 18,
    "syncStatus": "healthy",
    "updatedAt": "2026-04-23T10:00:00Z"
  }
}
```

### 5.2 `GET /api/v1/directory/users`

用途：

- 分页或按条件查询用户目录

请求参数建议：

| 参数 | 必填 | 说明 |
|---|---|---|
| `search` | 否 | 按姓名/昵称/邮箱等本地可检索字段搜索 |
| `deptCode` | 否 | 按主部门筛选 |
| `cursor` | 否 | 游标分页 |
| `limit` | 否 | 默认 50，最大 500 |

响应建议：

```json
{
  "code": 0,
  "data": {
    "items": [
      {
        "uid": "zhangsan",
        "realName": "张三",
        "nickname": "老张",
        "email": "zhangsan@example.com",
        "mobile": "13800000000",
        "avatar": "https://example.com/avatar.png",
        "deptCode": "RD",
        "deptName": "研发部",
        "status": 1
      }
    ],
    "nextCursor": "cursor_xxx"
  }
}
```

### 5.3 `GET /api/v1/directory/users/:uid`

用途：

- 获取单个用户详情

### 5.4 `GET /api/v1/directory/departments`

用途：

- 返回部门树和扁平列表

响应建议：

```json
{
  "code": 0,
  "data": {
    "tree": [],
    "flat": []
  }
}
```

### 5.5 `GET /api/v1/directory/dept-members`

用途：

- 返回指定部门成员列表

请求参数：

| 参数 | 必填 | 说明 |
|---|---|---|
| `deptCode` | 是 | 部门编码 |

### 5.6 `GET /api/v1/directory/user-departments`

用途：

- 返回全量 `uid ↔ dept_code` 关联
- 给本地物化视图或树组件批量构建使用

### 5.7 `GET /api/v1/directory/projects`

用途：

- 返回项目注册表

说明：

- 这里的 `project_code` 是跨模块稳定标识
- 目录服务只提供注册表与基础归属，不承载业务项目明细

### 5.8 `GET /api/v1/directory/users/:uid/projects`

用途：

- 返回用户可见或参与的项目注册表摘要

### 5.9 `GET /api/v1/directory/sync/meta`

用途：

- 返回用于本地缓存同步的版本元信息

响应建议：

```json
{
  "code": 0,
  "data": {
    "contractVersion": "dir.v1",
    "snapshotHash": "sha256_xxx",
    "syncCursor": "cursor_20260423_001",
    "userCount": 1280,
    "departmentCount": 42,
    "projectCount": 166,
    "syncLagSeconds": 18,
    "updatedAt": "2026-04-23T10:00:00Z"
  }
}
```

### 5.10 `GET /api/v1/directory/sync/changes`

用途：

- 返回相对某个 `cursor` 的增量变更

请求参数：

| 参数 | 必填 | 说明 |
|---|---|---|
| `cursor` | 是 | 上次同步游标 |
| `limit` | 否 | 默认 1000 |

响应建议：

```json
{
  "code": 0,
  "data": {
    "baseCursor": "cursor_20260423_001",
    "nextCursor": "cursor_20260423_002",
    "hasMore": false,
    "changes": [
      {
        "entityType": "user",
        "entityKey": "zhangsan",
        "changeType": "upsert",
        "payload": {}
      },
      {
        "entityType": "department",
        "entityKey": "RD",
        "changeType": "delete"
      }
    ]
  }
}
```

说明：

- `payload` 仅在客户侧传递，不会上报平台
- 删除必须通过 `changeType='delete'` 或 tombstone 明确表达

---

## 6. 平台侧 Runtime 契约

`directory-runtime` 作为 `console` 内的受管 capability，需要随 `console` deployment 遵守现有平台 runtime 契约：

- `POST /api/v1/runtime/heartbeat`
- `GET /api/v1/runtime/license/status`
- `GET /api/v1/policy/bundles/latest`
- `GET /api/v1/revocations/latest`

其中 heartbeat 额外要求上报：

- `directoryContractVersion`
- `directorySnapshotHash`
- `directorySyncCursor`
- `directoryUserCount`
- `directoryDepartmentCount`
- `directoryProjectCount`
- `directorySyncLagSeconds`
- `directorySyncAt`

这些字段应映射到平台库中的：

- `deployments.reported_directory_*`
- `deployments.last_directory_sync_at`
- `deployments.directory_contract_status`
- `deployments.directory_sync_status`
- `deployment_heartbeats.directory_*`

兼容模式下，如果 `directory-runtime` 仍独立部署，也使用相同字段；区别只是字段挂在独立 directory deployment，而不是 console deployment。

---

## 7. 契约兼容与健康判定

平台侧建议使用以下判定：

### 7.1 `directory_contract_status`

| 值 | 说明 |
|---|---|
| `n/a` | 非目录服务 deployment |
| `unknown` | 尚未完成检查 |
| `compatible` | 契约版本与平台要求一致 |
| `incompatible` | 契约缺字段、缺接口或版本不兼容 |

### 7.2 `directory_sync_status`

| 值 | 说明 |
|---|---|
| `n/a` | 非目录服务 deployment |
| `unknown` | 尚未收到摘要 |
| `healthy` | lag 与游标正常推进 |
| `lagging` | 仍在同步，但 lag 超阈值 |
| `stale` | 长时间没有成功同步 |
| `failed` | 明确出现同步失败 |

---

## 8. 迁移兼容策略

短期不要求马上把目录数据一次性搬进 console。

第一阶段可以：

- 继续由当前 `account` 模块提供目录能力作为迁移期事实源
- 但把新契约与新调用面统一收敛到 `directory-runtime`
- 由 console 逐步 mirror / fallback account，并最终成为目录运行时入口
- 新业务只认标准目录契约，不再把 `account` 当成平台控制面的一部分

责任边界应收敛为：

| 组件 | 负责 | 不负责 |
|---|---|---|
| `console.directory-runtime` | 用户、部门、岗位、项目注册表、目录同步、目录管理页面、最小 subject 投影 | 角色模板、License、跨应用授权裁决 |
| `account`（迁移期） | 现有目录事实源、兼容 API、fallback | 新增平台治理能力、长期必选运行时职责 |
| `platform` | 订阅、deployment、license、policy bundle、revocation、授权模型、目录 runtime 治理 | 通讯录明细托管、目录高频查询 |
| 业务应用 | 本地鉴权落地、业务关系求值、业务数据 | 目录主数据维护、平台授权治理 |

业务应用消费约定：

- 取授权结果时，优先消费平台下发的 token claims、policy bundle 和 runtime 配置
- 取姓名、部门、项目归属等目录字段时，调用 Foundation directory adapter；目标落到 `console.directory-runtime`，迁移期可 fallback account
- 不允许把目录查询回路和平台授权回路混成一个“统一回源接口”

推荐的兼容映射：

| 当前 Account API | 目标 Directory API |
|---|---|
| `GET /api/v1/users` | `GET /api/v1/directory/users` |
| `GET /api/v1/users/:uid` | `GET /api/v1/directory/users/:uid` |
| `GET /api/v1/departments` | `GET /api/v1/directory/departments` |
| `GET /api/v1/dept-members` | `GET /api/v1/directory/dept-members` |
| `GET /api/v1/user-departments` | `GET /api/v1/directory/user-departments` |
| `GET /api/v1/projects` | `GET /api/v1/directory/projects` |
| `GET /api/v1/users/:uid/projects` | `GET /api/v1/directory/users/:uid/projects` |

---

## 9. 非目标

第一版 `directory-runtime` 不承担：

- 平台员工后台登录
- 平台订单、License、订阅、公告等控制面职责
- 业务应用权限决策
- 平台侧用户、部门明细镜像

---

## 10. 结论

`directory-runtime` 的价值，不是把组织目录搬进平台，而是把它从“历史上的 Account 大一统模块”中拆成一个**客户侧受管基础服务逻辑域**，并在目标形态下收敛到 `console`。

最终边界应当是：

- `platform` 管治理
- `console.directory-runtime` 管目录明细
- `account` 只做迁移期兼容或下线
- `Foundation` 管适配
- 业务模块管自己的业务规则
