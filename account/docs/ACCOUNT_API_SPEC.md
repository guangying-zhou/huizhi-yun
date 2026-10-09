# huizhi-yun Account 模块 API 文档

> **版本：** v1.11
> **基础路径：** `https://account.wiztek.cn/api/v1`
> **文档更新：** 2026-03-30

## 在线接口文档

Account 模块已内置 OpenAPI 在线文档，当前仅展示 `/api/v1/**` 接口。

本地开发环境访问：

- `http://localhost:3000/scalar`：推荐，Scalar 交互式文档
- `http://localhost:3000/swagger`：Swagger UI
- `http://localhost:3000/openapi.json`：OpenAPI JSON 原始文档

生产环境访问：

- `https://account.wiztek.cn/scalar`
- `https://account.wiztek.cn/swagger`
- `https://account.wiztek.cn/openapi.json`

旧入口 `/_nitro/scalar`、`/_scalar`、`/_openapi.json` 等地址已兼容重定向到新路径，后续请统一使用上述新地址。

---

## 目录

- [认证方式](#认证方式)
- [通用响应格式](#通用响应格式)
- [API 列表](#api-列表)
  - [认证相关](#1-认证相关)
  - [用户信息](#2-用户信息)
  - [部门信息](#3-部门信息)
  - [审计日志](#4-审计日志)
  - [权限管理](#5-权限管理)
  - [资源同步](#6-资源同步)
  - [企业微信消息](#7-企业微信消息)
  - [AI 服务](#8-ai-服务)
  - [应用管理](#9-应用管理)
  - [用户在线](#10-用户在线)
  - [公司管理](#11-公司管理)
  - [业务领域](#12-业务领域)
  - [区域管理](#13-区域管理)
  - [粘贴板](#14-粘贴板)

---

## 认证方式

所有 API 请求必须携带有效的 API Key 进行认证。

### 获取 API Key

1. 登录管理后台 `https://account.wiztek.cn`
2. 进入 **系统管理 > API管理**
3. 点击 **新建密钥**，填写名称后获取 `api_key` 和 `api_secret`

> ⚠️ **重要**：`api_secret` 仅在创建时显示一次，请妥善保存！

### 认证方式

**方式一：HTTP Header（推荐）**

```http
Authorization: Bearer {api_key}:{api_secret}
```

示例：
```http
GET /api/v1/users/zhangsan HTTP/1.1
Host: account.wiztek.cn
Authorization: Bearer ak_abc123:sk_xyz789
```

**方式二：Query 参数**

```
?api_key={api_key}&api_secret={api_secret}
```

示例：
```
GET /api/v1/users/zhangsan?api_key=ak_abc123&api_secret=sk_xyz789
```

---

## 通用响应格式

### 成功响应

```json
{
  "code": 0,
  "message": "success",
  "data": { ... }
}
```

### 错误响应

```json
{
  "code": 40001,
  "message": "错误描述信息",
  "data": null
}
```

### 常见错误码

| 错误码 | 说明                           |
| ------ | ------------------------------ |
| 0      | 成功                           |
| 400    | 请求参数错误                   |
| 401    | 认证失败（API Key 无效）       |
| 403    | 权限不足或 API Key 已禁用/过期 |
| 404    | 资源不存在                     |
| 500    | 服务器内部错误                 |

---

## API 列表

---

## 1. 认证相关

### 说明

- 登录审计与业务操作审计已分离。
- 登录成功、失败、禁用账户拦截等事件统一写入 `login_logs`。
- 登录日志额外记录 `target_app`，用于标识本次登录目标模块。
- 业务关键操作统一写入 `operation_logs`。
- 登录日志与操作日志均保存 `session_id`，用于串联“登录 -> 后续关键操作”的安全追溯链路。
- 其他模块如需记录关键操作，请调用本文档中的统一操作日志上报接口，不再自行落本地日志表。

### 1.1 验证 Token

验证 API Key 是否有效。

**请求**

```
POST /api/v1/auth/verify-token
```

**请求头**

| 参数          | 类型   | 必填 | 说明                            |
| ------------- | ------ | ---- | ------------------------------- |
| Authorization | string | 是   | `Bearer {api_key}:{api_secret}` |

**响应**

```json
{
  "code": 0,
  "message": "Token is valid",
  "data": {
    "valid": true,
    "keyId": 1,
    "rateLimit": 1000
  }
}
```

**错误响应**

```json
{
  "code": 401,
  "message": "Invalid API key",
  "data": {
    "valid": false
  }
}
```

---

## 2. 用户信息

### 2.1 获取用户列表

分页获取用户列表，支持搜索和筛选。仅返回user_type==1 && status == 1的用户。

**请求**


```
GET /api/v1/users
```

**Query 参数**

| 参数      | 类型   | 必填 | 说明                             |
| --------- | ------ | ---- | -------------------------------- |
| search    | string | 否   | 搜索关键词（用户名、姓名、邮箱） |
| dept_code | string | 否   | 按部门编码筛选                   |

**响应**

```json
{
  "code": 0,
  "data": {
    "items": [
      {
        "uid": "zhangsan",
        "realName": "张三",
        "nickname": "老张",
        "email": "zhangsan@wiztek.cn",
        "mobile": "13800138000",
        "avatar": "zhangsan.png",
        "deptCode": "RD",
        "deptName": "研发部"
      }
    ],
    "tree": [
      {
        "deptCode": "HQ",
        "name": "公司总部",
        "children": [
          {
            "deptCode": "RD",
            "name": "研发部",
            "users": [
              {
                "uid": "zhangsan",
                "realName": "张三",
                "nickname": "老张",
                "email": "zhangsan@wiztek.cn",
                "mobile": "13800138000",
                "avatar": "zhangsan.png",
              }
            ]
          }
        ]
      }
    ]
  }
}
```

---

### 2.2 获取用户详情

根据用户名获取用户详细信息。仅返回user_type==1 && status == 1的用户信息。

**请求**

```
GET /api/v1/users/{uid}
```

**路径参数**

| 参数 | 类型   | 必填 | 说明              |
| ---- | ------ | ---- | ----------------- |
| uid  | string | 是   | 用户名 (LDAP uid) |

**响应**

```json
{
  "code": 0,
  "data": {
    "id": 1,
    "uid": "zhangsan",
    "realName": "张三",
    "nickname": "老张",
    "email": "zhangsan@wiztek.cn",
    "mobile": "13800138000",
    "avatar": "zhangsan.png",
    "gender": 1,
    "deptCode": "RD",
    "deptName": "研发部"
  }
}
```

**错误响应**

| 错误码 | 说明       |
| ------ | ---------- |
| 404    | 用户不存在 |

---

### 2.3 批量获取用户

根据用户ID列表或用户名列表批量获取用户信息。

**请求**

```
POST /api/v1/users/batch
```

**请求体**

```json
{
  "ids": [1, 2, 3]
}
```

或

```json
{
  "uids": ["zhangsan", "lisi", "wangwu"]
}
```

**请求体参数**

| 参数 | 类型     | 必填   | 说明       |
| ---- | -------- | ------ | ---------- |
| uids | string[] | 二选一 | 用户名列表 |

**响应**

```json
{
  "code": 0,
  "data": [
    {
    "id": 1,
    "uid": "zhangsan",
    "realName": "张三",
    "nickname": "老张",
    "email": "zhangsan@wiztek.cn",
    "mobile": "13800138000",
    "avatar": "zhangsan.png",
    "gender": 1,
    "deptCode": "RD",
    "deptName": "研发部"
    },
    {
    "id": 2,
    "uid": "lisi",
    "realName": "李四",
    "nickname": "小李",
    "email": "lisi@wiztek.cn",
    "mobile": "13800138001",
    "avatar": "lisi.png",
    "gender": 0,
    "deptCode": "RD",
    "deptName": "研发部"
    }
  ]
}
```

### 2.4 获取用户部门信息

**请求**

```
GET /api/v1/users/{uid}/department
```

**响应**

```json
{
  "code": 0,
  "data": {
    "deptCode": "RD",
    "name": "研发部",
    "parentId": "HQ",
    "level": 2,
    "orgType": "department",
    "deptCategory": 2,
    "leaderId": "tech_lead",
    "leader": "Tech Lead",
    "managerId": "tech_manager",
    "manager": "Tech Manager",
    "isActive": true,
    "description": "Development Department",
    "managed": [
      {
        "deptCode": "RD",
        "name": "研发部",
        "parentId": "HQ",
        "level": 2,
        "orgType": "department",
        "deptCategory": 2,
        "leaderId": "tech_lead",
        "leader": "Tech Lead",
        "managerId": "tech_manager",
        "manager": "Tech Manager",
        "isActive": true,
        "description": "Development Department"
      }
    ],
    "committees": [
      {
        "deptCode": "TCMT",
        "name": "技术委员会",
        "parentId": "HQ",
        "level": 2,
        "orgType": "committee",
        "deptCategory": null,
        "leaderId": null,
        "leader": null,
        "managerId": "tech_manager",
        "manager": "Tech Manager",
        "isActive": true,
        "description": "Technical Committee"
      }
    ],
    "led": [
      {
        "deptCode": "RD",
        "name": "研发部",
        "parentId": "HQ",
        "level": 2,
        "orgType": "department",
        "deptCategory": 2,
        "leaderId": "tech_lead",
        "leader": "Tech Lead",
        "managerId": "tech_manager",
        "manager": "Tech Manager",
        "isActive": true,
        "description": "Development Department"
      }
    ]
  }
}
```

---

### 2.5 获取用户权限

获取用户的角色和资源权限信息（RBAC 模型）。

权限按 `{appCode}:{resourceCode}` 分组，每个资源包含该用户拥有的操作列表（`view`/`edit`/`admin`）。

**请求**

```
GET /api/v1/users/{uid}/permissions
```

**路径参数**

| 参数 | 类型   | 必填 | 说明   |
| ---- | ------ | ---- | ------ |
| uid  | string | 是   | 用户名 |

**响应**

```json
{
  "code": 0,
  "data": {
    "uid": "zhangsan",
    "roles": [
      {
        "code": "admin",
        "name": "系统管理员"
      },
      {
        "code": "dept_manager",
        "name": "部门经理"
      }
    ],
    "resources": {
      "account:admin": ["view", "edit", "admin"],
      "account:profile": ["view", "edit"],
      "codocs:documents": ["view", "edit"],
      "codocs:admin": ["view", "admin"]
    }
  }
}
```

**权限继承规则**

- `admin` 隐含 `edit` 和 `view` 权限
- `edit` 隐含 `view` 权限
- 客户端应用在检查权限时应遵循此继承关系

---

## 3. 部门信息

### 3.1 获取部门列表

获取所有部门，返回树形结构和扁平列表两种格式。仅返回status==1的部门

`deptCategory` 说明：

- `1`：行政
- `2`：业务支撑
- `3`：业务
- `4`：核心管理
- `null`：不适用（如委员会）

**请求**

```
GET /api/v1/departments
```

**响应**

```json
{
  "code": 0,
  "data": {
    "tree": [
      {
        "deptCode": "HQ",
        "name": "公司总部",
        "parentId": null,
        "level": 1,
        "orgType": "department",
        "deptCategory": null,
        "managerId": "boss",
        "manager": "Boss",
        "leaderId": "boss",
        "leader": "Boss",
        "children": [
          {
            "deptCode": "RD",
            "name": "研发部",
            "parentId": "HQ",
            "level": 2,
            "orgType": "department",
            "deptCategory": 2,
            "managerId": "tech_manager",
            "manager": "Tech Manager",
            "leaderId": "tech_lead",
            "leader": "Tech Lead",
            "children": []
          },
          {
            "deptCode": "MC",
            "name": "营销中心",
            "parentId": "HQ",
            "level": 2,
            "orgType": "department",
            "deptCategory": 3,
            "managerId": "mkt_manager",
            "manager": "Mkt Manager",
            "leaderId": "mkt_lead",
            "leader": "Mkt Lead",
            "children": []
          }
        ]
      }
    ],
    "flat": [
      {
        "id": 1,
        "deptCode": "HQ",
        "name": "公司总部",
        "parentId": null,
        "level": 1,
        "orgType": "department",
        "deptCategory": null,
        "managerId": "boss",
        "manager": "Boss",
        "leaderId": "boss",
        "leader": "Boss"
      },
      {
        "id": 2,
        "deptCode": "RD",
        "name": "研发部",
        "parentId": "HQ",
        "level": 2,
        "orgType": "department",
        "deptCategory": 2,
        "managerId": "tech_manager",
        "manager": "Tech Manager",
        "leaderId": "tech_lead",
        "leader": "Tech Lead"
      },
      {
        "id": 3,
        "deptCode": "MC",
        "name": "营销中心",
        "parentId": "HQ",
        "level": 2,
        "orgType": "department",
        "deptCategory": 3,
        "managerId": "mkt_manager",
        "manager": "Mkt Manager",
        "leaderId": "mkt_lead",
        "leader": "Mkt Lead"
      }
    ]
  }
}
```

---

### 3.2 获取用户有权部门

返回指定用户有权限的部门列表。权限范围包括：

- 用户所在部门（`user_departments` 表）
- 用户作为部门经理（`manager`）的部门
- 用户作为分管领导（`leader`）的部门
- 以上部门的所有下属部门（递归）

结果自动排除顶级部门（`parent_id IS NULL`）和非 `department` 类型的组织。

**请求**

```
GET /api/v1/departments/accessible?uid=zhouguangying
```

| 参数 | 位置 | 必填 | 说明 |
|------|------|------|------|
| uid | query | 是 | 用户 UID |

**响应**

```json
{
  "code": 0,
  "data": [
    {
      "id": 2,
      "deptCode": "RD",
      "name": "研发部",
      "parentId": "HQ",
      "level": 2,
      "orgType": "department",
      "deptCategory": 2,
      "managerId": "tech_manager",
      "manager": "Tech Manager",
      "leaderId": "tech_lead",
      "leader": "Tech Lead"
    }
  ]
}
```

> 字段与 `GET /api/v1/departments` 的 `flat` 数组项结构一致。

---

## 4. 项目管理

### 4.1 获取项目列表

获取项目列表，支持按部门ID、项目负责人UID、搜索关键词筛选。

**请求**

```
GET /api/v1/projects
```

**Query 参数**

| 参数             | 类型    | 必填 | 说明                        |
| ---------------- | ------- | ---- | --------------------------- |
| dept_code        | string  | 否   | 部门ID                      |
| leader_uid       | string  | 否   | 项目负责人UID               |
| search           | string  | 否   | 搜索关键词                  |
| status           | number  | 否   | 状态 (1:启用)               |
| only_group       | boolean | 否   | 是否只查询组项目(默认false) |
| include_template | boolean | 否   | 是否包含模板项目(默认true)  |

**响应**

```json
{
  "code": 0,
  "data": {
    "items": [
      {
        "projectCode": "group-rd",
        "name": "Group RD",
        "deptCode": "RD",
        "leaderUid": "tech_lead",
        "description": "Group RD",
        "isGroup": 1,
        "isTemplate": 0,
        "status": 1,
        "repoUrl": "https://gitlab.wiztek.cn/group-rd",
        "subProjects": [
          {
            "projectCode": "sub-group-bdc",
            "name": "Group BDC Sub",
            "deptCode": "RD",
            "leaderUid": "zhangsan",
            "description": "Group BDC Sub",
            "isGroup": 1,
            "isTemplate": 0,
            "status": 1,
            "repoUrl": "https://gitlab.wiztek.cn/group-rd/sub-group-bdc",
            "subProjects": [
              {
                "projectCode": "sub-group-bdc-sub",
                "name": "Group BDC Sub Sub",
                "deptCode": "RD",
                "leaderUid": "zhangsan",
                "description": "Group BDC Sub Sub",
                "isGroup": 1,
                "isTemplate": 0,
                "status": 1,
                "repoUrl": "https://gitlab.wiztek.cn/group-rd/sub-group-bdc/sub-group-bdc-sub",
                "subProjects": []
              },
              {
                "projectCode": "project1",
                "name": "Project 1",
                "deptCode": "RD",
                "leaderUid": "zhangsan",
                "description": "Project 1",
                "isGroup": 0,
                "isTemplate": 0,
                "status": 1,
                "repoUrl": "https://gitlab.wiztek.cn/group-rd/project1",
                "docsSyncedAt": "2026-01-23 16:30:00",
                "docsCommittedAt": "2026-01-23 15:45:00"
              }
            ]
          }
        ]
      },
      {
        "projectCode": "project2",
        "name": "Project 2",
        "deptCode": "RD",
        "leaderUid": "zhangsan",
        "description": "Project 2",
        "isGroup": 0,
        "isTemplate": 0,
        "status": 1,
        "repoUrl": "https://gitlab.wiztek.cn/group-rd/project2",
        "docsSyncedAt": "2026-01-23 16:30:00",
        "docsCommittedAt": "2026-01-23 15:45:00"
      }
    ],
    "total": 10
  }
}
```

---

### 4.2 获取项目详情

获取单个项目详情，包含成员信息。

**请求**

```
GET /api/v1/projects/{project_code}
```

**路径参数**

| 参数                 | 类型    | 必填 | 说明                       |
| -------------------- | ------- | ---- | -------------------------- |
| project_code         | string  | 是   | 项目编码                   |
| include_sub_projects | boolean | 否   | 是否包含子项目(默认true)   |
| include_template     | boolean | 否   | 是否包含模板项目(默认true) |
**响应**

```json
{
  "code": 0,
  "data": {
    "projectCode": "group-rd",
    "parentId": null,
    "name": "Group RD",
    "deptCode": "RD",
    "leaderUid": "zhangsan",
    "description": "Group RD",
    "isGroup": 1,
    "isTemplate": 0,
    "status": 1,
    "repoUrl": "https://gitlab.wiztek.cn/rd/group-rd",
    "members": [
      {
        "uid": "zhangsan",
        "role": "admin"
      },
      {
        "uid": "lisi",
        "role": "member"
      }
    ],
    "subProjects": [
      {
        "projectCode": "sub-proj-abc",
        "name": "Sub Project ABC",
        "deptCode": "RD",
        "leaderUid": "zhangsan",
        "description": "Sub Demo Project",
        "isGroup": 0,
        "isTemplate": 0,
        "status": 1,
        "repoUrl": "https://gitlab.wiztek.cn/rd/sub-proj-abc",
        "docsSyncedAt": "2026-01-23 16:30:00",
        "docsCommittedAt": "2026-01-23 15:45:00",
        "members": [
          {
            "uid": "zhangsan",
            "role": "admin"
          },
          {
            "uid": "lisi",
            "role": "member"
          }
        ]
      }
    ]
  }
}
```

---

### 4.3 创建项目

创建新项目。

**请求**

```
POST /api/v1/projects
```

```json
{
  "projectCode": "proj-abc",
  "parentId": "proj-parent",
  "name": "Project ABC",
  "deptCode": "RD",
  "leaderUid": "zhangsan",
  "description": "...",
  "isGroup": 0,
  "isTemplate": 0,
  "repoUrl": "https://gitlab.wiztek.cn/rd/proj-abc",
  "creatorUid": "zhangsan",
  "members": [
    { "uid": "zhangsan", "role": "admin" },
    { "uid": "lisi", "role": "member" }
  ]
}
```

**响应**

```json
{
  "code": 0,
  "message": "success",
  "data": { "id": 1 }
}
```

---

### 4.4 更新项目

更新项目信息。

**请求**

```
PUT /api/v1/projects/{project_code}
```

**请求体**

同创建项目，可更新部分字段。

---

### 4.5 删除项目

删除项目（软删除）。

**请求**

```
DELETE /api/v1/projects/{project_code}
```

---

### 4.6 获取用户项目

查询用户参与的项目（分为负责的项目和作为成员的项目）。

- `managed`：用户作为 `leader_uid` 的项目。如果用户负责的是子项目，其父项目组会自动包含在结果中（子项目挂在 `subProjects` 下）。
- `joined`：用户通过 `git_project_members` 表加入的项目（排除已在 managed 中的）。

**请求**

```
GET /api/v1/users/{uid}/git-projects
```
**路径参数**

| 参数             | 类型    | 必填 | 说明                        |
| ---------------- | ------- | ---- | --------------------------- |
| include_template | boolean | 否   | 是否包含模板项目(默认true)  |
| only_group       | boolean | 否   | 是否只包含组项目(默认false) |

**响应**

```json
{
  "code": 0,
  "data": {
    "managed": [
      {
        "projectCode": "group-rd",
        "name": "Group RD",
        "deptCode": "RD",
        "leaderUid": "zhangsan",
        "description": "Group RD",
        "isGroup": 1,
        "isTemplate": 0,
        "status": 1,
        "repoUrl": "https://gitlab.wiztek.cn/rd/group-rd",
        "members": [
          {
            "uid": "zhangsan",
            "role": "leader"
          },
          {
            "uid": "lisi",
            "role": "member"
          }
        ],
        "subProjects": [
          {
            "projectCode": "sub-group-bdc",
            "name": "Sub Group BDC",
            "deptCode": "RD",
            "leaderUid": "zhangsan",
            "description": "Sub Group BDC",
            "isGroup": 1,
            "isTemplate": 0,
            "status": 1,
            "repoUrl": "https://gitlab.wiztek.cn/rd/sub-group-bdc",
            "members": [
              {
                "uid": "zhangsan",
                "role": "leader"
              },
              {
                "uid": "lisi",
                "role": "member"
              }
            ]
          },
          {
            "projectCode": "proj-b",
            "name": "Project B",
            "deptCode": "MC",
            "leaderUid": "zhangsan",
            "role": "member",
            "isGroup": 0,
            "isTemplate": 0,
            "status": 1,
            "repoUrl": "https://gitlab.wiztek.cn/mc/proj-b",
            "docsSyncedAt": "2026-01-22 10:20:00",
            "docsCommittedAt": "2026-01-22 09:30:00",
            "members": [
              {
                "uid": "zhangsan",
                "role": "leader"
              },
              {
                "uid": "lisi",
                "role": "member"
              }
            ]
          }
        ]
      }
    ],
    "joined": [
      {
        "projectCode": "group-rd",
        "name": "Group RD",
        "deptCode": "RD",
        "leaderUid": "zhangsan",
        "role": "member",
        "isGroup": 1,
        "isTemplate": 0,
        "status": 1,
        "repoUrl": "https://gitlab.wiztek.cn/rd/group-rd",
        "members": [
          {
            "uid": "zhangsan",
            "role": "leader"
          },
          {
            "uid": "lisi",
            "role": "member"
          }
        ],
        "subProjects": [
          {
            "projectCode": "proj-abc-sub",
            "name": "Project ABC Sub",
            "deptCode": "RD",
            "leaderUid": "zhangsan",
            "description": "Project ABC Sub",
            "isGroup": 0,
            "isTemplate": 0,
            "status": 1,
            "repoUrl": "https://gitlab.wiztek.cn/rd/proj-abc-sub",
            "docsSyncedAt": "2026-01-23 16:30:00",
            "docsCommittedAt": "2026-01-23 15:45:00",
            "members": [
              {
                "uid": "zhangsan",
                "role": "leader"
              },
              {
                "uid": "lisi",
                "role": "member"
              }
            ]
          }
        ]
      }
    ]
  }
}
```

### 4.7 从gitlab同步项目文档到OSS

通过gitlab API（GITLAB_BOT_USERNAME与GITLAB_BOT_TOKEN参数在.env.dev中）读取项目仓库中的README.md及/docs目录下的markdown文件，转存到OSS的codocs/git-projects/{project_code}/下。
转存时的处理逻辑如下：
1.OSS对应文件不存在，直接转存到OSS，并记录信息到“new”数组（commit信息取文件对应的最新一次提交）。
2.OSS对应文件存在，如果文件大小相同且文件内容md5与OSS的Etag一致，则跳过，并记录信息到“nochange”数组。
3.OSS对应文件存在，如果文件内容md5与OSS的Etag不一致，则把文件临时存储到codocs/git-projects/{project_code}/temp/下，计算diff并记录信息到“conflict”数组（commit信息取文件对应的最新一次提交）。
4.OSS文件存在，gitlab文件不存在，跳过，记录信息到“delete”数组（commit信息取仓库最新一次提交）。

**请求**

```
GET /api/v1/projects/{project_code}/gitlab-sync-docs
```

**响应**

```json
{
  "code": 0,
  "data": {
    "new": [
      {
      "doc_path": "docs/2.md",
      "oss_path": "{project_code}/docs/2.md",
      "content_size": 1024,
      "gitlab_commit_id": "01b0f308f6c9b2a35809ea984fde8fb3702ac03e",
      "gitlab_commit_time": "2026-01-23 16:30:00",
      "gitlab_committer": "zhangsan"
      }
    ],
    "updated": [
      {
      "doc_path": "docs/3.md",
      "oss_path": "{project_code}/docs/3.md",
      "content_size": 1024,
      "gitlab_commit_id": "01b0f308f6c9b2a35809ea984fde8fb3702ac03e",
      "gitlab_commit_time": "2026-01-23 16:30:00",
      "gitlab_committer": "zhangsan"
      }
    ],
    "nochange": [
      {
      "doc_path": "README.md",
      "oss_path": "{project_code}/README.md"
      },
      {
      "doc_path": "docs/1.md",
      "oss_path": "{project_code}/docs/1.md"
      }
    ],
    "conflict": [
      {
      "doc_path": "README.md",
      "oss_path": "{project_code}/README.md",
      "content_size": 1024,
      "gitlab_commit_id": "01b0f308f6c9b2a35809ea984fde8fb3702ac03e",
      "gitlab_commit_time": "2026-01-23 16:30:00",
      "gitlab_committer": "zhangsan",
      "diff": ""
      }
    ],
    "deleted": [
      {
      "oss_path": "{project_code}/docs/3.md",
      "gitlab_commit_id": "01b0f308f6c9b2a35809ea984fde8fb3702ac03e",
      "gitlab_commit_time": "2026-01-23 16:30:00",
      "gitlab_committer": "zhangsan"
      }
    ]
  }
}
```

### 4.8 使用GitLab版本覆盖文档

当检测到冲突时（`conflict-status: 1`），使用GitLab版本覆盖OSS当前版本。

**请求**

```
POST /api/v1/projects/{project_code}/use-gitlab-version
```

**请求体**

```json
{
  "uid": "zhangsan",
  "oss_path": "{project_code}/README.md"
}
```

**请求体参数**

| 参数     | 类型   | 必填 | 说明             |
| -------- | ------ | ---- | ---------------- |
| uid      | string | 是   | 操作用户的用户名 |
| oss_path | string | 是   | OSS文件路径      |

**响应**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "oss_path": "{project_code}/README.md",
    "content_size": 2048,
    "conflict_status": "0"
  }
}
```

**操作说明**

1. 将 `temp/{file}` 复制到主文件位置（覆盖）
2. 更新元数据：
   - `gitlab-commit-id` = `gitlab-latest-commit-id`
   - `conflict-status` = '0'
   - 更新 `oss-last-modified`
3. 删除 `temp/{file}` 和 `temp/{file}.diff`

---

### 4.9 忽略文档冲突

保留OSS当前版本，忽略此次GitLab更新。

**请求**

```
POST /api/v1/projects/{project_code}/ignore-conflict
```

**请求体**

```json
{
  "uid": "zhangsan",
  "oss_path": "{project_code}/README.md"
}
```

**请求体参数**

| 参数     | 类型   | 必填 | 说明             |
| -------- | ------ | ---- | ---------------- |
| uid      | string | 是   | 操作用户的用户名 |
| oss_path | string | 是   | OSS文件路径      |

**响应**

```json
{
  "code": 0,
  "message": "Conflict ignored successfully",
  "data": {
    "oss_path": "{project_code}/README.md",
    "conflict_status": "0"
  }
}
```

**操作说明**

1. OSS文件保持不变
2. 更新元数据：
   - `gitlab-latest-commit-id` = `gitlab-commit-id`（标记为已忽略）
   - `conflict-status` = '0'
3. 删除 `temp/{file}` 和 `temp/{file}.diff`

**注意**：忽略不是永久的，下次GitLab有新提交时会重新检测冲突。

---

### 4.10 提交项目文档到GitLab

**请求**

```
POST /api/v1/projects/{project_code}/gitlab-submit-docs
```

**请求体**

```json
{
  "uid": "zhangsan",
  "docs": [
    {
      "oss_path": "{project_code}/README.md",
      "gitlab_path": "README.md"
    },
    {
      "oss_path": "{project_code}/docs/1.md",
      "gitlab_path": "docs/1.md"
    }
  ]
}
```

**请求体参数**

| 参数 | 类型   | 必填 | 说明                                  |
| ---- | ------ | ---- | ------------------------------------- |
| uid  | string | 是   | 提交用户的用户名，将作为 Git 提交作者 |
| docs | array  | 是   | 要提交的文档列表                      |

**响应**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "revision": "",
    "commitId": ""
  }
}
```
---

## 5. 权限管理

### 5.1 检查用户权限

检查指定用户是否拥有某个资源的指定操作权限。

**请求**

```
POST /api/v1/permissions/check
```

**请求体**

```json
{
  "uid": "zhangsan",
  "appCode": "codocs",
  "resourceCode": "admin",
  "action": "admin"
}
```

**请求体参数**

| 参数         | 类型   | 必填 | 说明                                |
| ------------ | ------ | ---- | ----------------------------------- |
| uid          | string | 是   | 用户名                              |
| appCode      | string | 是   | 应用编码（如 `account`、`codocs`）  |
| resourceCode | string | 是   | 资源编码（如 `admin`、`documents`） |
| action       | string | 是   | 操作类型（`view`/`edit`/`admin`）   |

**响应**

```json
{
  "code": 0,
  "data": {
    "allowed": true
  }
}
```

---

## 6. 资源同步

### 6.1 同步应用资源定义

应用启动时调用此接口，将自身的资源清单（manifest）同步到 Account。

Account 会对比现有资源与传入清单：
- 新增的资源会被插入
- 已有的资源如名称/描述/排序有变化会被更新
- 清单中没有的旧资源会被标记为废弃（`status=0`）

**请求**

```
POST /api/v1/resources/sync
```

**请求体**

```json
{
  "appCode": "codocs",
  "resources": [
    {
      "code": "documents",
      "name": "文档管理",
      "description": "个人文档、收藏、共享、回收站",
      "sortOrder": 1
    },
    {
      "code": "admin",
      "name": "系统管理",
      "description": "发文流程、模板管理、系统设置、资讯管理",
      "sortOrder": 6
    }
  ]
}
```

**请求体参数**

| 参数      | 类型   | 必填 | 说明         |
| --------- | ------ | ---- | ------------ |
| appCode   | string | 是   | 应用编码     |
| resources | array  | 是   | 资源定义列表 |

**resources 数组项**

| 参数        | 类型   | 必填 | 说明     |
| ----------- | ------ | ---- | -------- |
| code        | string | 是   | 资源编码 |
| name        | string | 是   | 资源名称 |
| description | string | 否   | 资源描述 |
| sortOrder   | number | 否   | 排序序号 |

**响应**

```json
{
  "success": true,
  "data": {
    "inserted": 2,
    "updated": 1,
    "deprecated": 0
  }
}
```

---

## 7. 企业微信消息

通过企业微信 API 发送消息通知，支持文本、Markdown、文本卡片、图文等消息类型。

### 7.1 发送消息

**请求**

```
POST /api/v1/wecom/send
```

**请求体**

```json
{
  "touser": "zhouguangying",
  "msgtype": "text",
  "content": "这是一条测试消息"
}
```

**请求体参数**

| 参数        | 类型   | 必填 | 说明                                                                                       |
| ----------- | ------ | ---- | ------------------------------------------------------------------------------------------ |
| touser      | string | 否*  | 用户ID，多个用 `\|` 分隔，`@all` 表示所有人                                                |
| toparty     | string | 否*  | 部门ID，多个用 `\|` 分隔                                                                   |
| totag       | string | 否*  | 标签ID，多个用 `\|` 分隔                                                                   |
| msgtype     | string | 是   | 消息类型：`text` / `markdown` / `textcard` / `news` / `image` / `file` / `voice` / `video` |
| content     | string | 条件 | 消息内容（`text`、`markdown` 类型必填）                                                    |
| title       | string | 条件 | 标题（`textcard`、`news` 类型必填）                                                        |
| description | string | 条件 | 描述（`textcard`、`news` 类型）                                                            |
| url         | string | 条件 | 链接（`textcard`、`news` 类型）                                                            |
| btntxt      | string | 否   | 按钮文字（`textcard` 类型）                                                                |
| picurl      | string | 否   | 图片链接（`news` 类型）                                                                    |
| media_id    | string | 条件 | 媒体ID（`image`、`file`、`voice`、`video` 类型必填）                                       |
| articles    | array  | 否   | 图文消息列表（`news` 类型，替代 title/description/url/picurl）                             |
| safe        | number | 否   | 是否保密消息，0 或 1                                                                       |

> *`touser`、`toparty`、`totag` 至少需要填写一个

**响应**

成功：
```json
{
  "code": 0,
  "data": {
    "msgid": "xxx"
  }
}
```

失败：
```json
{
  "code": 40014,
  "message": "40014 - invalid access_token",
  "data": {
    "errcode": 40014,
    "errmsg": "invalid access_token"
  }
}
```

**消息日志**

每次调用发送接口，系统会自动将发送记录写入 `message_logs` 表（异步，不影响响应速度），记录内容包括：

| 字段       | 说明                                           |
| ---------- | ---------------------------------------------- |
| channel    | 发送渠道（固定 `wecom`）                       |
| msg_type   | 消息类型                                       |
| title      | 消息标题                                       |
| content    | 消息内容/描述                                  |
| url        | 跳转链接                                       |
| touser     | 接收用户（uid 用 `\|` 分隔）                   |
| toparty    | 接收部门                                       |
| totag      | 接收标签                                       |
| caller     | 调用来源模块（取自 `api_keys.company_code`，内部调用为 `account`） |
| status     | 发送状态：0 失败 / 1 成功                      |
| msgid      | 企业微信返回的 msgid                           |
| errcode    | 错误码                                         |
| errmsg     | 错误信息                                       |
| created_at | 发送时间                                       |

#### 消息类型示例

**发送 Markdown 消息**

```json
{
  "touser": "zhouguangying",
  "msgtype": "markdown",
  "content": "### 系统通知\n**重要**: 服务器将于今晚 23:00 维护"
}
```

**发送文本卡片**

```json
{
  "touser": "zhouguangying",
  "msgtype": "textcard",
  "title": "文档处理通知",
  "description": "您有一条待处理的文档",
  "url": "https://codocs.wiztek.cn/info/68",
  "btntxt": "查看详情"
}
```

**发送图文消息**

```json
{
  "touser": "zhouguangying",
  "msgtype": "news",
  "title": "新功能上线",
  "description": "我们刚刚发布了新功能，点击查看详情",
  "url": "https://oa.wiztek.cn",
  "picurl": "https://oa.wiztek.cn/images/logo.png"
}
```

---

### 7.2 健康检查

检查企业微信消息服务状态，无需认证。

**请求**

```
GET /api/v1/wecom/health
```

**响应**

```json
{
  "code": 0,
  "data": {
    "status": "ok",
    "configured": true,
    "timestamp": "2026-03-08T03:30:00.000Z"
  }
}
```

---

### 7.3 常见错误码

| 错误码 | 说明                | 处理方式             |
| ------ | ------------------- | -------------------- |
| 40014  | access_token 无效   | 服务端自动重试       |
| 42001  | access_token 已过期 | 服务端自动重试       |
| 81013  | 所有接收者都无效    | 检查用户ID           |
| 60020  | 不在应用可见范围    | 检查企业微信应用权限 |

---

## 8. AI 服务

### 说明

Account 模块作为统一 AI 网关，为各业务模块提供 AI 能力。当前默认接入**阿里云通义千问**（兼容 OpenAI API 格式），后续可扩展 DeepSeek、OpenAI 等提供商。

- 所有 AI API 遵循与其他接口相同的认证方式（API Key）
- 支持流式（SSE）和非流式两种响应模式
- 调用配额按应用维度管理，调用日志统一记录

### 8.1 AI 对话（Chat Completions）

通用对话接口，支持多轮对话、流式输出。

**请求**

```
POST /api/v1/ai/chat
```

**请求体**

```json
{
  "messages": [
    { "role": "system", "content": "你是一个专业的文档格式助手" },
    { "role": "user", "content": "请帮我修正以下文档的格式问题：..." }
  ],
  "model": "qwen-plus",
  "stream": false,
  "max_tokens": 2048,
  "temperature": 0.7,
  "action": "format_fix",
  "uid": "zhangsan"
}
```

**请求体参数**

| 参数        | 类型     | 必填 | 说明                                                                       |
| ----------- | -------- | ---- | -------------------------------------------------------------------------- |
| messages    | array    | 是   | 对话消息列表，格式同 OpenAI（role: system/user/assistant, content: string）|
| model       | string   | 否   | 模型ID，不传则使用提供商默认模型                                           |
| stream      | boolean  | 否   | 是否流式输出，默认 `false`                                                 |
| max_tokens  | number   | 否   | 最大输出token数，默认 4096                                                 |
| temperature | number   | 否   | 温度参数 0-2，默认 0.7                                                     |
| action      | string   | 否   | 调用场景标识，用于统计分析（如 `format_fix`、`auto_complete`、`rewrite`）   |
| uid         | string   | 否   | 调用用户UID，用于用量追踪                                                  |

**非流式响应**

```json
{
  "code": 0,
  "data": {
    "id": "chatcmpl-xxx",
    "model": "qwen-plus",
    "choices": [
      {
        "index": 0,
        "message": {
          "role": "assistant",
          "content": "以下是修正后的文档内容：..."
        },
        "finish_reason": "stop"
      }
    ],
    "usage": {
      "prompt_tokens": 125,
      "completion_tokens": 300,
      "total_tokens": 425
    }
  }
}
```

**流式响应（stream: true）**

响应头：
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

响应体（SSE 格式）：
```
data: {"id":"chatcmpl-xxx","model":"qwen-plus","choices":[{"index":0,"delta":{"role":"assistant","content":"以下"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","model":"qwen-plus","choices":[{"index":0,"delta":{"content":"是修正"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","model":"qwen-plus","choices":[{"index":0,"delta":{"content":"后的"},"finish_reason":null}]}

data: {"id":"chatcmpl-xxx","model":"qwen-plus","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":125,"completion_tokens":300,"total_tokens":425}}

data: [DONE]
```

**错误响应**

| 错误码 | 说明                                 |
| ------ | ------------------------------------ |
| 400    | 请求参数错误（messages 不能为空等）  |
| 403    | AI 服务未启用或应用配额已禁用        |
| 429    | 超出调用配额（日/月限额）            |
| 502    | AI 提供商请求失败                    |
| 504    | AI 提供商请求超时                    |

---

### 8.2 文本补全（Completions）

单次文本补全，适用于自动补全、续写等场景。

**请求**

```
POST /api/v1/ai/completions
```

**请求体**

```json
{
  "prompt": "以下是项目需求文档的第三章，请续写：\n\n3.1 系统架构设计\n本系统采用",
  "model": "qwen-plus",
  "stream": false,
  "max_tokens": 512,
  "temperature": 0.3,
  "action": "auto_complete",
  "uid": "zhangsan"
}
```

**请求体参数**

| 参数        | 类型    | 必填 | 说明                                         |
| ----------- | ------- | ---- | -------------------------------------------- |
| prompt      | string  | 是   | 待补全的文本                                 |
| model       | string  | 否   | 模型ID，不传则使用默认模型                   |
| stream      | boolean | 否   | 是否流式输出，默认 `false`                   |
| max_tokens  | number  | 否   | 最大输出token数，默认 512                    |
| temperature | number  | 否   | 温度参数 0-2，默认 0.3（补全场景建议低温度） |
| action      | string  | 否   | 调用场景标识                                 |
| uid         | string  | 否   | 调用用户UID                                  |

**响应**

```json
{
  "code": 0,
  "data": {
    "id": "cmpl-xxx",
    "model": "qwen-plus",
    "choices": [
      {
        "index": 0,
        "text": "微服务架构，包含以下核心服务：\n\n- 用户认证服务\n- 文档管理服务\n- ...",
        "finish_reason": "stop"
      }
    ],
    "usage": {
      "prompt_tokens": 50,
      "completion_tokens": 120,
      "total_tokens": 170
    }
  }
}
```

流式响应格式与 8.1 相同。

---

### 8.3 获取可用模型列表

获取当前启用的 AI 提供商及其可用模型。

**请求**

```
GET /api/v1/ai/models
```

**响应**

```json
{
  "code": 0,
  "data": {
    "defaultProvider": "qwen",
    "defaultModel": "qwen-plus",
    "providers": [
      {
        "providerCode": "qwen",
        "providerName": "通义千问",
        "isDefault": true,
        "models": [
          { "id": "qwen-turbo", "name": "通义千问-Turbo", "maxTokens": 8192 },
          { "id": "qwen-plus", "name": "通义千问-Plus", "maxTokens": 32768 },
          { "id": "qwen-max", "name": "通义千问-Max", "maxTokens": 32768 }
        ]
      }
    ]
  }
}
```

---

### 8.4 获取 AI 用量统计

获取指定应用的 AI 调用用量统计。需要 `account:ai` 的 `view` 权限。

**请求**

```
GET /api/v1/ai/usage
```

**Query 参数**

| 参数      | 类型   | 必填 | 说明                                        |
| --------- | ------ | ---- | ------------------------------------------- |
| app_code  | string | 否   | 应用编码，不传则返回所有应用汇总            |
| start_date| string | 否   | 起始日期（YYYY-MM-DD），默认当月1号         |
| end_date  | string | 否   | 结束日期（YYYY-MM-DD），默认今天            |

**响应**

```json
{
  "code": 0,
  "data": {
    "period": {
      "startDate": "2026-03-01",
      "endDate": "2026-03-15"
    },
    "summary": {
      "totalCalls": 1580,
      "totalTokens": 892350,
      "promptTokens": 456200,
      "completionTokens": 436150,
      "successRate": 98.5,
      "avgLatencyMs": 850
    },
    "byApp": [
      {
        "appCode": "codocs",
        "calls": 1580,
        "totalTokens": 892350,
        "quota": {
          "dailyLimit": 2000,
          "monthlyLimit": 50000,
          "dailyUsed": 120,
          "monthlyUsed": 1580
        }
      }
    ],
    "byAction": [
      { "action": "format_fix", "calls": 620, "totalTokens": 380000 },
      { "action": "auto_complete", "calls": 510, "totalTokens": 210000 },
      { "action": "rewrite", "calls": 450, "totalTokens": 302350 }
    ],
    "daily": [
      { "date": "2026-03-01", "calls": 98, "totalTokens": 52000 },
      { "date": "2026-03-02", "calls": 115, "totalTokens": 61000 }
    ]
  }
}
```

---

### 8.5 AI 健康检查

检查 AI 网关服务状态及提供商连通性，无需认证。

**请求**

```
GET /api/v1/ai/health
```

**响应**

```json
{
  "code": 0,
  "data": {
    "status": "ok",
    "enabled": true,
    "defaultProvider": "qwen",
    "providers": [
      {
        "providerCode": "qwen",
        "providerName": "通义千问",
        "status": "ok",
        "latencyMs": 230
      }
    ],
    "timestamp": "2026-03-15T10:30:00.000Z"
  }
}
```

---

### 8.6 Codocs 推荐场景用法

以下为 Codocs 模块调用 AI 网关的典型场景及建议参数：

| 场景       | action 值       | 建议 model    | temperature | max_tokens | stream |
| ---------- | --------------- | ------------- | ----------- | ---------- | ------ |
| 格式纠正   | `format_fix`    | `qwen-plus`   | 0.3         | 2048       | false  |
| 自动补全   | `auto_complete` | `qwen-turbo`  | 0.3         | 256        | false  |
| 文本改写   | `rewrite`       | `qwen-plus`   | 0.7         | 2048       | false  |
| 长文本生成 | `generate`      | `qwen-plus`   | 0.7         | 4096       | true   |
| 内容摘要   | `summarize`     | `qwen-plus`   | 0.3         | 1024       | false  |
| 智能问答   | `chat`          | `qwen-plus`   | 0.7         | 4096       | true   |

---

## 使用示例

### Node.js / TypeScript

```typescript
import axios from 'axios'

const API_BASE = 'https://account.wiztek.cn/api/v1'
const API_KEY = 'ak_xxx'
const API_SECRET = 'sk_yyy'

const client = axios.create({
  baseURL: API_BASE,
  headers: {
    'Authorization': `Bearer ${API_KEY}:${API_SECRET}`
  }
})

// 获取用户信息
async function getUser(uid: string) {
  const { data } = await client.get(`/users/${uid}`)
  return data.data
}

// 检查权限（RBAC 资源+操作模型）
async function checkPermission(uid: string, appCode: string, resourceCode: string, action: string) {
  const { data } = await client.post('/permissions/check', {
    uid,
    appCode,
    resourceCode,
    action
  })
  return data.data.allowed
}

// 获取用户全部权限
async function getUserPermissions(uid: string) {
  const { data } = await client.get(`/users/${uid}/permissions`)
  return data.data // { uid, roles, resources }
}

// 使用示例
const user = await getUser('zhangsan')
console.log(user.realName) // 张三

const canAdmin = await checkPermission('zhangsan', 'codocs', 'admin', 'admin')
console.log(canAdmin) // true

const perms = await getUserPermissions('zhangsan')
console.log(perms.resources) // { "codocs:documents": ["view","edit"], ... }

// 发送企业微信消息
async function sendWecomMessage(touser: string, msgtype: string, content: string) {
  const { data } = await client.post('/wecom/send', {
    touser,
    msgtype,
    content
  })
  return data
}

const result = await sendWecomMessage('zhangsan', 'text', '来自 codocs 的通知')
console.log(result.data.msgid)

// AI 对话（非流式）
async function aiChat(messages: Array<{role: string, content: string}>, options?: {model?: string, action?: string, uid?: string}) {
  const { data } = await client.post('/ai/chat', {
    messages,
    stream: false,
    ...options
  })
  return data.data
}

const result2 = await aiChat([
  { role: 'system', content: '你是一个文档格式助手' },
  { role: 'user', content: '请修正以下文档格式...' }
], { action: 'format_fix', uid: 'zhangsan' })
console.log(result2.choices[0].message.content)

// AI 对话（流式 SSE）
async function aiChatStream(messages: Array<{role: string, content: string}>, onChunk: (text: string) => void) {
  const response = await fetch(`${API_BASE}/ai/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${API_KEY}:${API_SECRET}`
    },
    body: JSON.stringify({ messages, stream: true })
  })
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value)
    const lines = chunk.split('\n').filter(line => line.startsWith('data: '))
    for (const line of lines) {
      const data = line.slice(6)
      if (data === '[DONE]') return
      const parsed = JSON.parse(data)
      const content = parsed.choices[0]?.delta?.content
      if (content) onChunk(content)
    }
  }
}
```

### Python

```python
import requests

API_BASE = 'https://account.wiztek.cn/api/v1'
API_KEY = 'ak_xxx'
API_SECRET = 'sk_yyy'

headers = {
    'Authorization': f'Bearer {API_KEY}:{API_SECRET}'
}

# 获取用户信息
def get_user(uid: str):
    resp = requests.get(f'{API_BASE}/users/{uid}', headers=headers)
    return resp.json()['data']

# 检查权限（RBAC 资源+操作模型）
def check_permission(uid: str, app_code: str, resource_code: str, action: str) -> bool:
    resp = requests.post(f'{API_BASE}/permissions/check',
                        headers=headers,
                        json={
                            'uid': uid,
                            'appCode': app_code,
                            'resourceCode': resource_code,
                            'action': action
                        })
    return resp.json()['data']['allowed']

# 获取用户全部权限
def get_user_permissions(uid: str):
    resp = requests.get(f'{API_BASE}/users/{uid}/permissions', headers=headers)
    return resp.json()['data']  # { uid, roles, resources }

# 使用示例
user = get_user('zhangsan')
print(user['realName'])  # 张三

can_admin = check_permission('zhangsan', 'codocs', 'admin', 'admin')
print(can_admin)  # True

perms = get_user_permissions('zhangsan')
print(perms['resources'])  # { "codocs:documents": ["view","edit"], ... }

# 发送企业微信消息
def send_wecom_message(touser: str, msgtype: str, content: str):
    resp = requests.post(f'{API_BASE}/wecom/send',
                        headers=headers,
                        json={
                            'touser': touser,
                            'msgtype': msgtype,
                            'content': content
                        })
    return resp.json()

result = send_wecom_message('zhangsan', 'text', '来自 Python 的测试消息')
print(result)  # { "code": 0, "data": { "msgid": "..." } }
```

---

## 4. 审计日志

### 4.1 上报登录日志

供其他模块在本模块完成认证后，将登录事件统一上报到 Account 模块，集中写入 `login_logs`。

**请求**

```
POST /api/v1/login-logs
```

**请求头**

| 参数          | 类型   | 必填 | 说明                            |
| ------------- | ------ | ---- | ------------------------------- |
| Authorization | string | 是   | `Bearer {api_key}:{api_secret}` |

**请求体**

| 参数          | 类型   | 必填 | 说明                                                            |
| ------------- | ------ | ---- | --------------------------------------------------------------- |
| uid           | string | 否   | 登录用户 UID，失败时可为空                                      |
| targetApp     | string | 否   | 登录目标模块编码，写入 `login_logs.target_app`，默认 `external` |
| loginType     | string | 是   | 登录方式，取值：`password`、`sso`、`oauth`                      |
| loginResult   | number | 是   | 登录结果，取值：`0` 失败、`1` 成功                              |
| failureReason | string | 否   | 登录失败原因                                                    |
| sessionId     | string | 否   | 本次登录会话 ID，建议与后续关键操作日志共用                     |
| ipAddress     | string | 否   | 登录 IP，未传时默认取当前请求 IP                                |
| device        | string | 否   | 设备信息                                                        |
| browser       | string | 否   | 浏览器                                                          |
| os            | string | 否   | 操作系统                                                        |

**请求示例**

```json
{
  "uid": "zhangsan",
  "targetApp": "codocs",
  "loginType": "sso",
  "loginResult": 1,
  "sessionId": "ST-1234567890",
  "ipAddress": "10.20.30.40"
}
```

**成功响应**

```json
{
  "code": 0,
  "message": "success",
  "data": null
}
```

### 4.2 上报关键操作日志

供其他模块统一提交关键操作日志，由 Account 模块集中写入 `operation_logs`。来源应用会单独存入 `source_app` 字段，便于筛选和统计。

建议记录以下类型操作：

- 文档发布、撤回、删除
- 权限变更、成员变更、角色调整
- 项目、部门、应用、资源等配置项变更
- 其他影响数据安全、权限边界、业务状态的重要动作

不建议将高频、低价值行为全部写入该接口，例如页面浏览、普通列表查询、输入框变更等。

**请求**

```
POST /api/v1/operation-logs
```

**请求头**

| 参数          | 类型   | 必填 | 说明                            |
| ------------- | ------ | ---- | ------------------------------- |
| Authorization | string | 是   | `Bearer {api_key}:{api_secret}` |

**请求体**

| 参数           | 类型   | 必填 | 说明                                                                                     |
| -------------- | ------ | ---- | ---------------------------------------------------------------------------------------- |
| sourceApp      | string | 否   | 来源模块编码，如 `codocs`、`account`，写入 `source_app` 字段，默认 `external`            |
| sessionId      | string | 否   | 当前操作所属会话 ID，写入 `operation_logs.session_id`，建议与对应登录日志共用            |
| action         | string | 是   | 操作标识，建议使用 `domain.action` 或 `domain.action.result` 风格，如 `document.publish` |
| targetType     | string | 否   | 目标对象类型，如 `document`、`project`、`department`                                     |
| targetId       | string | 否   | 目标对象标识，可传业务主键、编码或 UID                                                   |
| detail         | object | 否   | 扩展信息，建议传入结构化 JSON                                                            |
| result         | string | 否   | 操作结果，取值：`success`、`failed`，默认 `success`                                      |
| operatorUid    | string | 否   | 操作者 UID                                                                               |
| operatorUserId | number | 否   | 操作者用户 ID                                                                            |

**请求示例**

```json
{
  "sourceApp": "codocs",
  "sessionId": "ST-1234567890",
  "action": "document.publish",
  "targetType": "document",
  "targetId": "doc_20260314_001",
  "result": "success",
  "operatorUid": "zhangsan",
  "detail": {
    "title": "汇智云实施方案",
    "spaceId": 12,
    "version": 5
  }
}
```

**成功响应**

```json
{
  "code": 0,
  "message": "success",
  "data": null
}
```

**错误响应**

| 错误码 | 说明                   |
| ------ | ---------------------- |
| 400    | `action` 不能为空      |
| 401    | API Key 无效           |
| 403    | API Key 已禁用或已过期 |

### 4.3 设计说明

- 当前采用同步写库，不引入 MQ。
- 原因是当前关键操作量可控，写入链路短，失败语义明确，便于审计追踪与问题排查。
- `operation_logs.source_app` 作为来源应用主筛选字段，`detail` 中的 `sourceApp` 仅保留为兼容性冗余信息。
- `login_logs.session_id` 与 `operation_logs.session_id` 用于追踪同一安全会话下的后续关键操作。
- 当出现明显跨模块写入峰值、批量异步审计需求，或日志写入已影响主业务响应时间时，再评估引入 MQ 更合适。

---

## 限流说明

每个 API Key 有调用频率限制，默认为 **1000 次/分钟**。

超出限制时将返回 `429 Too Many Requests` 错误。

如需提高限额，请联系系统管理员调整 API Key 的 `rate_limit` 配置。

---

## 9. 应用管理

### 9.1 获取用户可访问的应用列表

根据用户 uid 查询该用户有权访问的已启用应用。应用可见性由 `applications.access_scope` 控制：

- `all`：所有用户可见
- `user`：仅 `app_access_rules` 中指定的用户可见
- `department`：仅 `app_access_rules` 中指定部门的成员可见

**请求**

```
GET /api/v1/applications?uid={uid}
```

**Query 参数**

| 参数 | 类型   | 必填 | 说明   |
| ---- | ------ | ---- | ------ |
| uid  | string | 是   | 用户名 |

**响应**

```json
{
  "code": 0,
  "data": [
    {
      "appCode": "account",
      "appName": "账号管理",
      "description": "统一用户、权限、组织管理",
      "icon": "https://oss.wiztek.cn/icons/account.png",
      "homeUrl": "https://account.wiztek.cn",
      "appType": "internal"
    },
    {
      "appCode": "codocs",
      "appName": "协同文档",
      "description": "在线文档协作与知识管理",
      "icon": "https://oss.wiztek.cn/icons/codocs.png",
      "homeUrl": "https://codocs.wiztek.cn",
      "appType": "internal"
    }
  ]
}
```

**错误响应**

| 错误码 | 说明              |
| ------ | ----------------- |
| 400    | 缺少 uid 参数     |
| 401    | API Key 无效      |

**典型用途**

各子模块（codocs、aims 等）通过 server 端代理调用此接口，为前端 AppLauncher 组件提供动态应用列表，实现类似 Google 产品右上角的应用切换入口。应用信息（名称、图标、URL）统一在 Account 后台的应用管理页面维护，无需各模块硬编码。

---

## 10. 用户在线

基于心跳机制的用户在线状态管理。各模块前端定时上报心跳，Account 集中存储和查询。

### 10.1 上报心跳

```
POST /api/v1/heartbeat
Authorization: Bearer {api_key}:{api_secret}
```

**请求体：**

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `uid` | string | 是 | 用户 UID |
| `sourceApp` | string | 是 | 来源模块编码（codocs、aims、altoc、assets、workflow） |
| `page` | string | 否 | 当前页面路径 |
| `status` | string | 否 | `active`（活跃，默认）或 `idle`（空闲） |

**响应：**

```json
{ "success": true }
```

**调用频率建议：** 每 2 分钟上报一次。

### 10.2 查询在线用户

```
GET /api/v1/heartbeat/online
Authorization: Bearer {api_key}:{api_secret}
```

**查询参数：**

| 参数 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `sourceApp` | string | 否 | 按模块过滤 |

**响应：**

```json
{
  "success": true,
  "data": {
    "total": 3,
    "items": [
      {
        "uid": "zhangsan",
        "sourceApp": "codocs",
        "page": "/mydocs",
        "status": "active",
        "lastSeen": "2026-03-24 10:05:32"
      }
    ]
  }
}
```

**在线状态判断规则：**

| 状态 | 条件 | 说明 |
|------|------|------|
| 活跃 | `status = active` 且 `lastSeen` 在 5 分钟内 | 用户 10 分钟内有鼠标/键盘等交互 |
| 空闲 | `status = idle` 且 `lastSeen` 在 5 分钟内 | 用户 10-30 分钟无交互 |
| 离线 | `lastSeen` 超过 5 分钟 | 不在查询结果中返回 |

### 10.3 集成说明

各模块通过以下方式集成心跳功能：

1. **前端 composable** `useHeartbeat(appCode)` — 在 `layouts/default.vue` 中调用，自动监听用户交互并定时上报
2. **后端代理** `POST /api/heartbeat` — 每个模块自带的代理端点，转发到 Account 的 v1 API（使用 API Key 认证）

前端不直接调用 Account API，而是调用自己模块的代理端点，由后端转发，避免暴露 API Key。

### 10.4 数据库表

```sql
CREATE TABLE user_heartbeats (
    uid VARCHAR(50) NOT NULL,
    source_app VARCHAR(50) NOT NULL,
    page VARCHAR(255) NULL,
    status ENUM('active', 'idle') NOT NULL DEFAULT 'active',
    last_seen DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (uid, source_app)
);
```

使用 `REPLACE INTO` 实现 upsert，同一用户在同一模块只保留最新一条心跳记录。

---

---

### 11. 公司管理

#### 11.1 获取公司列表

```
GET /api/v1/companies
```

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| search | string | 否 | 搜索关键词（公司名/简称/编码） |
| status | number | 否 | 状态筛选：1启用 0禁用 |

**响应：**

```json
{
  "code": 0,
  "data": [
    {
      "id": 1,
      "companyCode": "C000001",
      "companyName": "默认公司",
      "shortName": "默认",
      "logo": null,
      "industry": null,
      "scale": null,
      "province": null,
      "city": null,
      "address": null,
      "contactName": null,
      "contactPhone": null,
      "contactEmail": null,
      "website": null,
      "description": null,
      "status": 1,
      "createdAt": "2026-03-25 00:00:00",
      "updatedAt": "2026-03-25 00:00:00"
    }
  ]
}
```

#### 11.2 获取公司详情

```
GET /api/v1/companies/:companyCode
```

**路径参数：**

| 参数 | 类型 | 说明 |
|------|------|------|
| companyCode | string | 公司编码（如 C000001） |

**响应：** 同列表中单个对象结构。

#### 11.3 创建公司

```
POST /api/v1/companies
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| companyName | string | 是 | 公司全称 |
| shortName | string | 否 | 简称 |
| industry | string | 否 | 行业 |
| scale | string | 否 | 规模：micro/small/medium/large |
| province | string | 否 | 省 |
| city | string | 否 | 市 |
| address | string | 否 | 地址 |
| contactName | string | 否 | 联系人 |
| contactPhone | string | 否 | 电话 |
| contactEmail | string | 否 | 邮箱 |
| website | string | 否 | 官网 |
| description | string | 否 | 简介 |

**响应：**

```json
{
  "code": 0,
  "message": "创建成功",
  "data": { "id": 2, "companyCode": "C000002" }
}
```

#### 11.4 更新公司信息

```
PATCH /api/v1/companies/:companyCode
```

**请求体：** 同创建，所有字段均可选，额外支持 `status`（number）。

---

### 12. 业务领域

#### 12.1 获取领域字典（系统预置）

```
GET /api/v1/business-domains
```

**查询参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| category | string | 否 | 大类筛选：2G/2B/2C |

**响应：**

```json
{
  "code": 0,
  "data": [
    {
      "id": 1,
      "domainCode": "GOV",
      "domainName": "政务领域",
      "category": "2G",
      "parentCode": null,
      "description": null,
      "sortOrder": 1
    }
  ]
}
```

#### 12.2 获取公司已选领域

```
GET /api/v1/companies/:companyCode/business-domains
```

**响应：**

```json
{
  "code": 0,
  "data": [
    {
      "id": 1,
      "companyCode": "C000001",
      "domainCode": "GOV_NR",
      "domainName": "自然资源",
      "category": "2G",
      "aliasName": null,
      "displayName": "自然资源",
      "source": "preset",
      "sortOrder": 1
    }
  ]
}
```

#### 12.3 添加公司领域（单条/批量）

```
POST /api/v1/companies/:companyCode/business-domains
```

**请求体（单条）：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| domainCode | string | 是 | 领域编码 |
| domainName | string | 是 | 领域名称 |
| category | string | 是 | 大类：2G/2B/2C |
| aliasName | string | 否 | 别名 |
| source | string | 否 | preset/custom，默认 preset |
| sortOrder | number | 否 | 排序 |

**请求体（批量）：**

```json
{
  "domains": [
    { "domainCode": "GOV_NR", "domainName": "自然资源", "category": "2G" },
    { "domainCode": "BIZ_I", "domainName": "信息技术服务业", "category": "2B" }
  ]
}
```

#### 12.4 更新公司领域（别名/排序/状态）

```
PATCH /api/v1/companies/:companyCode/business-domains/:domainCode
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| aliasName | string | 否 | 自定义别名（null 清除） |
| sortOrder | number | 否 | 排序 |
| status | number | 否 | 1启用 0禁用 |

#### 12.5 删除公司领域

```
DELETE /api/v1/companies/:companyCode/business-domains/:domainCode
```

---

### 13. 区域管理

#### 13.1 获取公司区域列表

```
GET /api/v1/companies/:companyCode/regions
```

**响应：**

```json
{
  "code": 0,
  "data": [
    {
      "id": 1,
      "companyCode": "C000001",
      "regionCode": "NORTH_CHINA",
      "regionName": "华北",
      "description": null,
      "sortOrder": 1,
      "divisionCount": 5
    }
  ]
}
```

#### 13.2 创建区域

```
POST /api/v1/companies/:companyCode/regions
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| regionCode | string | 是 | 区域编码 |
| regionName | string | 是 | 区域名称 |
| description | string | 否 | 描述 |
| sortOrder | number | 否 | 排序 |
| divisions | array | 否 | 初始行政区划 `[{divisionCode, includeChildren}]` |

#### 13.3 从模板初始化区域

```
POST /api/v1/companies/:companyCode/regions?fromTemplate=STANDARD_7
```

从系统预置模板（如标准七大区 `STANDARD_7`）批量初始化公司区域。

#### 13.4 更新区域

```
PATCH /api/v1/companies/:companyCode/regions/:regionCode
```

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| regionName | string | 否 | 区域名称 |
| description | string | 否 | 描述 |
| sortOrder | number | 否 | 排序 |
| status | number | 否 | 1启用 0禁用 |

#### 13.5 删除区域

```
DELETE /api/v1/companies/:companyCode/regions/:regionCode
```

删除区域及其所有行政区划映射。

#### 13.6 获取区域行政区划映射

```
GET /api/v1/companies/:companyCode/regions/:regionCode/divisions
```

**响应：**

```json
{
  "code": 0,
  "data": [
    { "id": 1, "divisionCode": "110000", "includeChildren": true },
    { "id": 2, "divisionCode": "120000", "includeChildren": true }
  ]
}
```

> 前端根据 `divisionCode` 调用 `lcn` 包获取区划名称和下级展开。

#### 13.7 设置区域行政区划（全量替换）

```
PUT /api/v1/companies/:companyCode/regions/:regionCode/divisions
```

**请求体：**

```json
{
  "divisions": [
    { "divisionCode": "110000", "includeChildren": true },
    { "divisionCode": "120000", "includeChildren": true },
    { "divisionCode": "210100", "includeChildren": true }
  ]
}
```

全量替换该区域下的行政区划映射。

---

## 14. 粘贴板

跨模块临时粘贴板，每用户仅保留最新一条，30 分钟后自动过期。内存缓存，无需数据库。

### 14.1 写入粘贴板

**请求**

```
POST /api/v1/clipboard
```

**请求体**

```json
{
  "uid": "zhangsan",
  "content": "## 标题\n\n这是一段 **Markdown** 内容",
  "contentType": "markdown",
  "sourceApp": "codocs"
}
```

**请求体参数**

| 参数        | 类型   | 必填 | 说明                                         |
| ----------- | ------ | ---- | -------------------------------------------- |
| uid         | string | 是   | 用户 UID                                     |
| content     | string | 是   | 粘贴板内容（最大 512 KB）                    |
| contentType | string | 否   | 内容类型：`markdown`（默认）、`text`、`json` |
| sourceApp   | string | 否   | 来源模块编码，如 `codocs`、`account`         |

**响应**

```json
{
  "code": 0,
  "message": "ok"
}
```

### 14.2 读取粘贴板

**请求**

```
GET /api/v1/clipboard?uid=zhangsan
```

**Query 参数**

| 参数 | 类型   | 必填 | 说明     |
| ---- | ------ | ---- | -------- |
| uid  | string | 是   | 用户 UID |

**响应**

```json
{
  "code": 0,
  "message": "ok",
  "data": {
    "content": "## 标题\n\n这是一段 **Markdown** 内容",
    "contentType": "markdown",
    "sourceApp": "codocs",
    "createdAt": "2026-03-30T08:00:00.000Z"
  }
}
```

粘贴板为空或已过期时 `data` 为 `null`。

---

## 更新日志

| 版本 | 日期       | 说明                                                                                                                                                                             |
| ---- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1.11 | 2026-03-30 | 新增跨模块粘贴板 API（`POST /api/v1/clipboard`、`GET /api/v1/clipboard`），内存缓存，30 分钟过期，支持 Markdown 富文本片段传递 |
| v1.10 | 2026-03-30 | 部门信息新增 `deptCategory` 字段；部门列表与用户部门接口同步返回部门类别，支持区分行政、业务支撑、业务、核心管理 |
| v1.9 | 2026-03-26 | 企业微信消息发送接口新增 `message_logs` 数据库日志记录，自动记录发送渠道、内容、接收人、调用来源和发送结果 |
| v1.8 | 2026-03-25 | SaaS 化基础：新增公司管理 CRUD（`/api/v1/companies`）、业务领域字典及公司领域管理（`/api/v1/business-domains`、`/api/v1/companies/:code/business-domains`）、区域管理及行政区划映射（`/api/v1/companies/:code/regions`），支持模板初始化 |
| v1.7 | 2026-03-24 | 新增用户在线心跳 API：心跳上报（`POST /api/v1/heartbeat`）、在线用户查询（`GET /api/v1/heartbeat/online`），各模块通过前端 `useHeartbeat` composable 自动上报 |
| v1.6 | 2026-03-18 | 新增应用管理 API：获取用户可访问的应用列表（`GET /api/v1/applications?uid=`），供各子模块 AppLauncher 动态获取应用入口 |
| v1.5 | 2026-03-15 | 新增 AI 网关服务：对话、补全、模型列表、用量统计、健康检查接口（`/api/v1/ai/*`），默认接入通义千问 |
| v1.4 | 2026-03-14 | 登录审计与操作审计职责拆分；登录日志新增 `target_app` 与统一上报 API（`/api/v1/login-logs`）；操作日志新增 `source_app`、`session_id` 与统一上报 API（`/api/v1/operation-logs`） |
| v1.3 | 2026-03-10 | 用户部门接口新增 `committees` 字段；用户项目接口 managed 自动包含父项目组；部门成员改用 `org_type` 区分部门/委员会                                                               |
| v1.2 | 2026-03-08 | 新增企业微信消息发送 API（`/api/v1/wecom/send`、`/api/v1/wecom/health`）                                                                                                         |
| v1.1 | 2026-03-07 | RBAC 权限模型改造：资源+操作替代旧权限码，新增资源同步 API                                                                                                                       |
| v1.0 | 2026-01-19 | 初始版本，包含用户、部门、权限相关 API                                                                                                                                           |

---

> 如有疑问或建议，请联系 admin@wiztek.cn
