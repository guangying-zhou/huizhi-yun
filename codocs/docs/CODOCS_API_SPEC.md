# Codocs 模块间 API 规范

版本：2.1
日期：2026-08-28
状态：DRAFT

## 概述

### 项目文档服务（2026-09-19）

`POST /api/v1/service/project-document-access/execute` 接受 `{ serviceCommand }`。固定调用方 `aims.runtime`，分别校验 `codocs:project-document-access:read`（search/summary/policy-read/check/audit）、`:manage`（policy-update）、`:create`（create）。签名 schema、actor/tenant/deployment 绑定及幂等约束见根 `docs/MODULE_CONTRACTS.md` 的项目文档补充。调用方签名不能替代当前项目关系与对象授权；目标使用自己的 Runtime token。

项目文件柜上传增加可选 `document_uuid`；提供时只接受一个文件。相同 UUID 和不可变元数据可重放，不同内容或归属冲突。正文创建和附件创建失败可用原 UUID 重试；存储错误不再伪装成功。正文读取携带当前 event 解析 Console 存储配置，不依赖某次此前上传留下的全局配置。

Codocs 对外提供的 RESTful API，供汇智云平台其他模块（Aims、Workflow、Altoc 等）调用。当前 `/api/v1/documents/**` 服务接口由 Codocs Nuxt BFF 完成鉴权、OSS 内容读写和响应兼容，文档元数据、搜索、批量摘要、创建记录等数据访问必须通过 tenant-runtime 的 `/v1/codocs/**` 合同完成，不再直连 Codocs DB。

`document-shares`、`document-versions`、`annotations`、`annotation-replies` 与 `issue-comments` 没有独立的 generic runtime CRUD 合同。它们只能经已有的文档、批注或问题嵌套路由，由 BFF 和 runtime 共同校验父对象 ACL；任何直达 `/v1/codocs/{resource}/**` 的 generic 形态均返回 `503 scoped_resource_contract_required` 且不会访问数据库。

Issues 的浏览器 BFF 合同为单项目：`GET /api/issues`、`GET /api/issues/pending-count`、`GET /api/issues/{id}`、`PATCH/DELETE /api/issues/{id}` 与 `POST /api/issues/{id}/comments` 都必须提供目标 `project_code`；`POST /api/issues` 使用 body 中同字段。BFF 只在受信会话、Console Directory 项目/成员/部门事实与 Foundation scoped `projects:view|edit` 同时成立时转发。runtime 不接受浏览器自报的 actor 或项目范围，全部 SQL 都以 BFF 写入、request-target HMAC 覆盖的项目 marker 过滤。`document_uuid`（如提供）只接受同项目 active `project|git-project` 文档。

### 认证方式

所有接口使用 Console 签发的 service token 认证：

```
Authorization: Bearer {Console service access token}
```

Token 必须包含调用接口所需 scope，例如 `codocs:documents:read` 或 `codocs:documents:write`。旧 API Key 方式仅作为历史说明，不再作为新增接口方案。

### 基础信息

- Base URL: `{HZY_CODOCS_API_URL}/api/v1`（如 `http://localhost:3001/api/v1`）
- 响应格式: JSON
- 字符编码: UTF-8

### 通用响应结构

```json
// 成功
{
  "code": 0,
  "data": { ... }
}

// 失败
{
  "code": 1,
  "message": "错误描述"
}
```

### 通用 HTTP 状态码

| 状态码 | 含义 |
|--------|------|
| 200 | 成功 |
| 400 | 请求参数错误 |
| 401 | 认证失败（用户会话或 Console service token 无效、过期或已撤销） |
| 403 | 无权限访问该资源 |
| 404 | 资源不存在 |
| 409 | 资源冲突（如重复创建） |
| 500 | 服务端错误 |

---

## 0. 浏览器目录兼容 BFF

只读文档水印通过 Foundation `GET /api/directory/me` 读取当前 Console 会话用户的 `realName` 与 `mobileTail4`；仅接受四位数字尾号，缺失时显示 `****`。不再通过共享人员搜索获取手机号，缓存按租户和用户隔离。

`/api/account/**` 仅保留历史浏览器路径名称，并不是 Codocs 到 legacy Account 的新调用面。它们通过 Foundation 的 Console Directory adapter 读取 Console；Console 返回的 `401/403` 必须直接失败，不能回退 Account 或另一目录来源。

所有这些兼容读取在调用 Directory adapter 前必须取得经过验证的 Codocs 会话主体。以下自助读取还必须将 URL/query 中的 `uid` 精确绑定到该会话主体，不能借应用级目录配置查询其他人的关系：

- `GET /api/account/user?uid=`
- `GET /api/account/user-departments?uid=`
- `GET /api/account/users/{uid}/projects`

其余用户、部门和项目目录读取仅用于已登录协作界面的最小展示/选择投影；不得作为匿名目录代理，也不得用浏览器输入伪造 actor、tenant 或上游目录范围。

---

## 0.1 旧企业微信浏览器回调

Console OIDC 是 Codocs 默认登录路径。历史 `GET /api/auth/wecom-login`、
`GET /api/auth/wecom-callback` 与 `GET /api/wecom/oauth` 都属于直连企业微信
登录入口或回调，仅当明确配置
`HZY_AUTH_MODE=legacy` 或 `HZY_LEGACY_AUTH_BRIDGE=true` 时才可使用。默认
模式下三条路由在读取 query、解析/调用企业微信、重定向、查询
legacy/Console 目录、写入 legacy cookie 或记录审计之前返回 `410`；客户端
必须改用 Console OIDC。

`GET /WW_verify_cLzQx20CTaflmPf7.txt`（内部 route rule 代理至
`/api/wecom/verify`）只回传企业微信可信域名验证文本，不读取 OAuth 参数、
不交换身份且不写入会话，因此不属于认证入口，也不受上述登录开关限制。

---

## 0. 运维知识关联

### 0.1 关联运维知识上下文

将已有 Codocs 文档 UUID 标记为运维知识，并通过 `document_relations` 关联客户、合同、项目、正式交付资产、环境和服务工单六类上下文。接口只写文档关系索引，不写业务模块主档，也不复制文档正文；这些关系不授予文档读取、编辑或评论权限。

```
POST /api/v1/service/ops-knowledge/link
```

**认证：** Console service token，`aud=codocs`，`scope=codocs:documents:write`，来源应用 `altoc`。

**请求体：**

```json
{
  "documentUuid": "550e8400-e29b-41d4-a716-446655440000",
  "sourceApp": "altoc",
  "customerCode": "CUST-001",
  "contractCode": "CT-2026-001",
  "maintenanceContractCode": "MC-2026-001",
  "projectCode": "PRJ-001",
  "deliveryCode": "DLV-001",
  "deliveryAssetCode": "CDA-001",
  "environmentCode": "ENV-001",
  "ticketCode": "ST-2026-001",
  "artifactType": "ops_knowledge"
}
```

**响应：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "documentUuid": "550e8400-e29b-41d4-a716-446655440000",
    "title": "某客户生产故障复盘",
    "docType": "knowledge",
    "relationType": "ops_knowledge",
    "linkedCount": 6
  }
}
```

`sourceApp` 由 Codocs BFF 根据已验证的 service token 强制写为 `altoc`；请求体中的 actor 字段只可用于审计，不参与关系唯一键或 ACL。六条关系在同一事务内 upsert，`document_relations` 表或必要上下文缺失时失败关闭。

**调用方：** 仅 Altoc（服务工单复盘 / 知识归档）。

---

## 0.2 Aims 新建项目部门文档候选

```
POST /api/v1/service/department-documents/search
```

仅用于 Aims 新建项目时选择待关联的部门文档。认证必须是 Console service token：`aud=codocs`、来源应用 `aims`、来源 client `aims.runtime`、精确 capability `codocs:department-documents:list`；通配符、管理员 scope、`codocs:documents:read` 和任何 `data-runtime:codocs:*` 都不能替代。

请求只接受固定 schema `aims.codocs.department-documents.list.v1` 的短时 signed service-command，command 固定包含已登录 Aims actor、精确 `deptCode`、最多 200 条的 `pageSize` 与 `action=list`。Aims 先确认 actor 可访问该部门；首跳 token 绑定来源 deployment，可信服务路由把传输上下文切换到 Codocs 目标 deployment，两个 deployment 分别进入 command HMAC，禁止混用。Codocs 验证 service token、tenant、source/target deployment 与首跳 command HMAC 后，再以目标 `codocs.runtime` 身份通过 Console Directory 独立确认同一 actor 对同一部门的读取关系，最后重签第二跳。Runtime 从签名 command 重建全部筛选条件，只返回 `status=1`、`doc_type=department`、`dept_code` 精确相等的目录与文档。

产品规则选择“该用户在该部门内可读取的全部部门文档均可作为立项书候选”，不要求预先写入 `project_proposal` 分类。这里的候选资格只用于创建前选择，不授予项目成员后续读取权限；绑定后的正文读取仍必须使用项目关联正文专用合同并重新执行 Codocs 原 ACL。响应只包含目录定位和文档最小摘要，不含正文、OSS path、签名 URL、授权策略或其他部门数据。

---

## 0.3 Aims 项目关联正文读取

```
POST /api/v1/service/project-documents/{uuid}/content
```

仅用于已关联项目文档的 Markdown 正文读取。认证必须是 Console service token：`aud=codocs`、`token_use=service`、精确 capability `codocs:project-document:content:read`；`codocs:*`、`codocs:admin` 与 `codocs:documents:read` 都不能替代。来源应用只接受两条**并列**条目之一——`aims` + `aims.runtime`，或 ADR-018 统一企业宿主的 `enterprise` + `enterprise.runtime`。两条的 capability、`operationCode` 与命令 schema 完全相同，宿主不是放宽 Aims 那条；app 与 client 必须各自匹配，`aims` + `enterprise.runtime`（及反向）等交叉组合在 BFF 与 runtime 两层都拒绝，未登记的第三方来源一律拒绝。Codocs 在读取 body、调用 runtime 或读取 OSS 前，必须把 token tenant/deployment 与受信 `x-hzy-tenant` / `x-hzy-deployment` 精确绑定。

请求只接受固定 schema `aims.codocs.project-document.content.v1` 的 one-shot service-command：command 内的 `actorUid`、`projectCode`、路径 UUID 和 `action=content:read` 必须相互一致，并由 Aims 刚签发的短时 `aud=codocs` service token 对 canonical method/path、tenant/deployment、source/target app+client、完整固定 envelope、command hash 与 request ID 做 60 秒 HMAC。Codocs 必须在读取 runtime 或 OSS 前验证该首跳 HMAC；任何 actor、project、UUID、route、envelope、hash 或时限篡改均拒绝，然后才以自身 runtime bearer 重签第二跳。Aims 必须先在本域验证 active 项目成员、leader、creator 或 scoped-admin，并证明该 UUID 精确出现在 `project_documents.codocs_uuid` 或文档型 deliverable；浏览器不可指定 capability、actor、project、UUID 或 command hash。

Codocs runtime 使用受签名 actor 重施 Codocs 原 owner/share/relation ACL；Aims 项目关系只是额外范围条件，不是文档 ACL。文档必须为 `status=1`，但不要求其物理 `doc_type` 为 `project|git-project`，也不要求可空的 `documents.project_code` 等于 Aims project code：历史项目关联可以指向已有部门或个人文档，项目边界由 Aims 已验证关联和签名 command 固定，读取权限仍由 Codocs ACL 独立决定。拒绝不创建 preview relation，不接受项目/角色 body claim，也不返回 OSS path、签名 URL、策略或 grant。

**响应：**

```json
{
  "code": 0,
  "data": {
    "uuid": "550e8400-e29b-41d4-a716-446655440000",
    "title": "需求说明",
    "docType": "project",
    "contentSize": 24576,
    "content": "# 需求说明",
    "updatedAt": "2026-07-12 12:00:00"
  }
}
```

该合同不恢复 `/api/v1/documents/{uuid}/{summary|url|content}` 的宽 service read、search、batch-summary 或 preview-access；后者仍按各自 fail-closed 合同处理。

宿主来源时，本域项目文档访问权限由 Enterprise Host 在发起调用前判定（`assertCodocsProjectDocumentAccess`），Codocs 侧的验证与 ACL 重施完全不变。合同与验收状态见根 `docs/MODULE_CONTRACTS.md`「ADR-018 Enterprise → Codocs 项目文档正文」。

---

## 0.4 Altoc 实体关联文档读取与已有 UUID 关联

`POST /api/v1/service/altoc-entity-documents/{uuid}/content` 仅供 Altoc 对已经持久关联到其实体的文档预览；Altoc 必须先用当前会话重验实体 `view` 范围和精确 `document_link`。`POST .../{uuid}/attach` 仅在 Altoc 已重验实体 `edit` 范围与实体存在后，授权写入已有 UUID 的 link。两条接口均要求 `aud=codocs`、`source_app/client=altoc`、精确 capability（分别为 `codocs:altoc-entity-document:content:read`、`codocs:altoc-entity-document:attach`）、tenant/deployment 绑定，以及用刚签发短 token 对 actor、允许实体类型、实体 ID、UUID、action、method/path/envelope/request ID 做的 60 秒 HMAC。

Codocs 在读 body 后的 runtime/OSS 前验证 HMAC，再以自身 runtime bearer 重签。runtime 必须对受签名 actor 重施 owner/share/relation ACL；`attach` 还要求 active 文档和 owner 或显式 write share，read share、relation、readonly 与 archived 均拒绝。实体权限不是 Codocs ACL，任何响应不得带 OSS path、签名 URL 或策略细节。不存在宽 UUID summary/content/search/batch 路由；v1.53 grant/verify 仅为待批准输入，未执行。

---

## 0.5 Aims 公司周报发布

```
POST /api/v1/service/company-weekly-summaries/{periodKey}:publish
```

仅接受 `aims.runtime` 使用精确 capability `codocs:company-weekly-summary:publish` 提交的不可变周报版本。Aims 必须通过短期 `aud=codocs` service token 对 method/path、request ID、tenant、Aims source deployment、Codocs target deployment、完整 service-command envelope 与 command hash 做 HMAC；request-bound 调用从受信 route catalog 解析目标 deployment，event-less drain 必须显式配置 `HZY_CODOCS_TARGET_DEPLOYMENT`。Codocs 在读取 OSS 或调用自身 runtime 前，分别以 token 绑定 source deployment、以受信请求上下文绑定 target deployment，并验证同一签名；不得要求二者相等，也不得接受缺失任一 deployment 的调用。

请求 body 固定包含 `serviceCommand` 和与其 `markdownSha256` 完全一致的 `markdownContent`。目标端以 `periodKey + revisionNo` 和 operation/idempotency identity 收敛重放，成功响应必须提供稳定 receipt、文档 UUID、版本号和内容哈希。

---

## 1. 文档查询

### 1.1 宽文档摘要（已停用）

这个历史路径不再是跨模块 service 合同。通用 `codocs:documents:read` 不能证明调用方的业务对象范围，也不能把来源应用的浏览器 actor 绑定到 Codocs 原 owner/share/relation ACL；因此不得用它实现 Aims 新建项目的部门文档选择或任何其他跨模块摘要读取。Aims 只能使用上文专用的 `POST /api/v1/service/department-documents/search`。

```
GET /api/v1/documents/{uuid}/summary
```

该 UUID 摘要路径仍失败关闭；新建项目页面不再调用它。部门候选合同只能按签名 actor 与精确部门列出最小集合，不能按浏览器 UUID 扩大范围，也不能恢复通用 summary/search/batch/content。

---

### 1.2 批量获取文档摘要

> **已退役（2026-07-11）**：此 generic service endpoint 只依赖宽
> `codocs:documents:read` 和调用方提供的 UUID，无法证明项目或父对象范围；现在固定返回
> `503 scoped_document_service_contract_required`，不读取请求体或访问 tenant-runtime。后续仅可由绑定来源、租户/部署、actor、对象事实与动作的专用 service-command 替代。

一次获取多个文档的摘要信息，减少多次请求。

```
POST /api/v1/documents/batch-summary
```

**请求体：**

```json
{
  "uuids": [
    "550e8400-e29b-41d4-a716-446655440000",
    "660e8400-e29b-41d4-a716-446655440001"
  ]
}
```

**限制：** 单次最多 50 个 UUID

**响应：**

```json
{
  "code": 0,
  "data": [
    {
      "uuid": "550e8400-...",
      "title": "汇智云项目PRD V1.0",
      "docType": "project",
      "status": 1,
      "contentSize": 24576,
      "updatedAt": "2026-03-28T15:30:00.000Z"
    },
    {
      "uuid": "660e8400-...",
      "title": null,
      "error": "not_found"
    }
  ]
}
```

**说明：** 不存在或无权限的文档返回 `error` 字段而非整体报错，调用方可据此做容错展示。

**调用方：** Aims（工作项列表页批量展示关联文档标题）

---

### 1.3 获取文档内容

获取文档完整 Markdown 内容。

```
GET /api/v1/documents/{uuid}/content
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| format | string | 否 | 返回格式：`markdown`(默认) / `html` / `plain` |

**响应：**

```json
{
  "code": 0,
  "data": {
    "uuid": "550e8400-...",
    "title": "汇智云项目PRD V1.0",
    "content": "# 概述\n\nAims 是汇智云的核心业务模块...",
    "format": "markdown",
    "contentSize": 24576,
    "updatedAt": "2026-03-28T15:30:00.000Z"
  }
}
```

**调用方：** Aims（AI 需求拆解时读取 PRD 内容）、Workflow（审批详情查看附件内容）

---

### 1.4 搜索文档

> **已退役（2026-07-11）**：此 generic service endpoint 只依赖宽
> `codocs:documents:read` 和调用方筛选条件，无法证明项目范围；现在固定返回
> `503 scoped_document_service_contract_required`，不读取 query 或访问 tenant-runtime。后续仅可由来源域的专用范围合同替代。

按关键词、类型、所属项目等条件搜索文档。

```
GET /api/v1/documents/search
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| keyword | string | 否 | 标题关键词搜索 |
| doc_type | string | 否 | 文档类型筛选 |
| project_code | string | 否 | 所属项目编码（精确匹配或模糊匹配关联仓库下的文档） |
| dept_code | string | 否 | 所属部门编码 |
| owner_uid | string | 否 | 所有者 UID |
| page | number | 否 | 页码，默认 1 |
| page_size | number | 否 | 每页数量，默认 20，最大 100 |

**响应：**

```json
{
  "code": 0,
  "data": {
    "items": [
      {
        "uuid": "550e8400-...",
        "title": "汇智云项目PRD V1.0",
        "docType": "project",
        "ownerUid": "zhouguangying",
        "projectCode": "huizhi-yun/aims",
        "contentSize": 24576,
        "aiAbstract": "...",
        "updatedAt": "2026-03-28T15:30:00.000Z"
      }
    ],
    "total": 15,
    "page": 1,
    "pageSize": 20
  }
}
```

**调用方：** Aims（关联文档时搜索选择）、Altoc（查找客户相关文档）

---

## 2. 文档创建与管理

### 2.1 创建文档

由其他模块触发创建文档（如 Aims 创建需求时自动生成 PRD 模板）。

```
POST /api/v1/documents
```

**请求体：**

```json
{
  "title": "需求规格说明书 - HZY-42",
  "docType": "project",
  "ownerUid": "zhouguangying",
  "deptCode": "HW",
  "projectCode": "huizhi-yun/aims",
  "content": "# 需求背景\n\n（待填写）\n\n# 功能描述\n\n（待填写）",
  "templateId": 5
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| title | string | 是 | 文档标题 |
| docType | string | 否 | 文档类型；不传时按业务上下文自动归类 |
| ownerUid | string | 是 | 所有者 UID |
| deptCode | string | 否 | 所属部门 |
| projectCode | string | 否 | 所属项目集/项目 |
| sourceApp | string | 否 | 来源业务应用，如 `aims` / `altoc` / `assets` |
| productCode | string | 否 | 产品编码；用于自动归入产品文档 |
| customerCode / contractCode | string | 否 | 客户 / 合同上下文；用于自动归入销售文档 |
| content | string | 否 | 初始 Markdown 内容 |
| templateId | number | 否 | 基于模板创建（使用模板内容） |

自动归类规则：显式传 `docType` 时以调用方为准；未传时，Aims 或带 `projectCode` 的上下文归入 `project`，Altoc 或带客户 / 合同上下文归入 `sale`，Assets 的产品上下文归入 `product`，Assets 的资产 / 交付上下文无项目时归入 `knowledge`。

**响应：**

```json
{
  "code": 0,
  "data": {
    "uuid": "770e8400-e29b-41d4-a716-446655440002",
    "title": "需求规格说明书 - HZY-42",
    "docType": "project",
    "projectCode": "HZY-42",
    "createdAt": "2026-03-28T16:00:00.000Z"
  }
}
```

**调用方：** Aims（工作项创建时自动生成配套文档）、Workflow（审批发起时生成审批记录文档）

---

### 2.2 更新文档元信息

更新文档标题、类型等元信息（不含正文内容，正文通过协作编辑器修改）。

```
PATCH /api/v1/documents/{uuid}
```

**请求体：**（所有字段可选）

```json
{
  "title": "新标题",
  "deptCode": "HW",
  "projectCode": "huizhi-yun/aims"
}
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "uuid": "550e8400-...",
    "title": "新标题",
    "updatedAt": "2026-03-28T16:10:00.000Z"
  }
}
```

---

### 2.3 创建个人或部门目录

```
POST /api/folders
```

这是登录用户使用的 Codocs BFF 接口，要求 `documents:create`。当前专用
tenant-runtime 写入合同只接受：

- `folder_type=private`：服务端忽略调用方传入的 `owner_uid`、`dept_code` 和
  `project_code`，始终把目录绑定到当前登录用户。
- `folder_type=department`：必须提供 `dept_code`；BFF 先校验当前用户是该部门负责人，
  再把精确部门管理标记随 Foundation 签名请求传给 runtime，runtime 会再次比对。

`parent_id` 如不为空，runtime 会确认父目录与新目录具有完全相同的类型和归属范围：
私人目录按当前用户 `owner_uid` 隔离；部门目录按 `dept_code` 隔离，存量父目录中仅用于
记录创建人的 `owner_uid` 不参与部门命名空间判断。不同用户的私人目录、不同部门的部门
目录都禁止挂载。`project`、`slide`、`publish` 目录尚未完成各自的来源范围写入合同，
当前仍返回 `503`，不得回退 generic table insert。

---

## 3. 文档模板

### 3.1 获取模板列表

获取可用的文档模板，用于其他模块创建文档时选择模板。

```
GET /api/v1/templates
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| category | string | 否 | 模板分类：`requirement` / `design` / `test` / `report` / `general` |

**响应：**

```json
{
  "code": 0,
  "data": [
    {
      "id": 1,
      "title": "需求规格说明书模板",
      "category": "requirement",
      "description": "标准的需求文档模板，含背景、功能描述、非功能需求等章节"
    },
    {
      "id": 2,
      "title": "测试报告模板",
      "category": "test",
      "description": "测试计划、用例、执行结果、缺陷统计"
    }
  ]
}
```

**调用方：** Aims（创建需求时选择 PRD 模板、里程碑交付物自动生成对应模板文档）

---

## 4. 文档访问链接

### 4.1 生成文档访问 URL

生成一个可跳转到 Codocs 编辑器的 URL，供其他模块前端跳转使用。

```
GET /api/v1/documents/{uuid}/url
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| mode | string | 否 | `edit`(默认) / `readonly` |

**响应：**

```json
{
  "code": 0,
  "data": {
    "url": "https://codocs.wiztek.cn/documents/550e8400-e29b-41d4-a716-446655440000",
    "mode": "edit"
  }
}
```

**说明：** 调用方前端可直接 `window.open(url)` 打开 Codocs 编辑器。无需额外认证（CAS SSO 统一登录）。

**调用方：** Aims（点击关联文档跳转编辑）、所有模块

---

### 4.2 已发布资产的直达阅读链接

组织资产和部门已发布文档工具栏提供「复制链接」，目标分别为 `/company/document?path=<编码后的OSS路径>` 和 `/departments/document?path=<编码后的OSS路径>`。客户端通过 Foundation `useAppUrls` 生成当前租户域名、应用前缀（如 `/codocs`）下的完整 URL。历史仅有 OSS 文件、没有文档 UUID 的已发布资产同样适用；链接不包含访问令牌或临时 OSS 签名。

阅读页直接调用已有 `/api/company-assets/preview` 或 `/api/dept-assets/preview`，沿用登录、`company:view` / `departments:view` 检查与只读水印，不授予匿名阅读或新增目录权限。登录回跳保留完整目标 URL。路径仅接受各自已发布分类的合法文件路径，缺失、无效、越界、不存在或无权限时显示明确提示。

自动发布通知中的「查看文档」同样携带实际发布资产路径并直达正文；历史缺少有效路径的通知仍回退原分类页。文件移动、改名或归档后旧路径可能失效，需重新复制链接。

## 5. 版本与历史

### 5.1 获取文档版本列表

```
GET /api/v1/documents/{uuid}/versions
```

**请求参数：**

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | 否 | 页码，默认 1 |
| page_size | number | 否 | 每页数量，默认 20 |

**响应：**

```json
{
  "code": 0,
  "data": {
    "items": [
      {
        "versionNum": 5,
        "editorUid": "zhouguangying",
        "editorName": "周光营",
        "contentSize": 24576,
        "createdAt": "2026-03-28T15:30:00.000Z"
      }
    ],
    "total": 5
  }
}
```

**调用方：** Aims（里程碑交付物检查时查看文档是否有最新版本）

Enterprise 完整文档工作区另以固定 `codocs:personal-documents:read` 委托操作读取版本：列表目标为 `GET /v1/codocs/documents/{uuid}/versions`；指定版本目标为 `GET /v1/codocs/documents/{uuid}/versions/{versionId}`。后者在受信 actor 和当前文档 ACL 通过后，以 `versionId + document_id` 精确查询单行，返回 `success/data` 版本行；无该文档版本为 404，不再为详情拉取全部版本。两条路径均不得接受浏览器提供的 actor 或受信标记。此为源码合同，目标环境 Runtime 更新与实际 OSS 历史正文读取仍需单独验证。

---

## 6. AI 能力

### 6.1 获取文档 AI 摘要

获取或生成文档的 AI 摘要。

```
GET /api/v1/documents/{uuid}/ai-abstract
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "uuid": "550e8400-...",
    "abstract": "本文档描述了汇智云 Aims 模块的产品需求，涵盖项目管理、迭代看板、任务管理等核心功能...",
    "generatedAt": "2026-03-28T14:00:00.000Z"
  }
}
```

**调用方：** Aims（工作项详情页展示关联文档摘要）、搜索引擎（索引文档内容）

---

### 6.2 AI 需求拆解（预留）

基于文档内容，AI 自动建议需求拆分。

```
POST /api/v1/documents/{uuid}/ai-decompose
```

**请求体：**

```json
{
  "targetType": "requirement",
  "maxItems": 10,
  "context": "该文档是项目管理模块的PRD"
}
```

**响应：**

```json
{
  "code": 0,
  "data": {
    "suggestions": [
      {
        "title": "项目 CRUD + 列表",
        "description": "项目创建、编辑、归档、列表展示",
        "priority": "P0",
        "estimatedHours": 16
      },
      {
        "title": "迭代看板",
        "description": "Kanban 视图、拖拽操作、WIP 限制",
        "priority": "P0",
        "estimatedHours": 24
      }
    ]
  }
}
```

**调用方：** Aims（基于 PRD 文档自动拆解需求/任务）

---

## 7. 发布申请与 Workflow 审批

### 7.1 创建发布申请

```
POST /api/reviews/publish-requests
```

创建 Codocs 本地发布申请、复制审批快照并锁定源文档。发布类型到归档目标的映射由 Codocs 服务端确定，流程定义、路由和节点不再读取 Codocs 本地模板表。响应只返回发布申请标识和草稿状态；浏览器不得直接调用 Workflow `prepare/create`，绑定必须走下节受信 service-command。

### 7.2 绑定 Workflow 实例

```
POST /api/reviews/publish-requests/{id}/workflow-instance
```

仅已验证的发布申请发起人且具备 `reviews:submit` 可调用。Codocs runtime 在事务中锁定 publish request/document，以固定 `codocs.publish-request.workflow-submit.v1` 命令、`workflow:document-publish:create`、`documents/publish`、稳定 request-derived identity 和固定 callback 请求 Workflow。调用方不能提交 app/resource/action/path/actor/instance/idempotency；Workflow receipt 同键同 hash 恢复、异 hash 冲突，重试仅按已验证 receipt 固定的 `instance_no` 恢复实例 ID，Codocs 再回写 `workflow_instance_id`、`workflow_instance_no` 与 `running`。

### 7.3 Workflow 终态回调

```
POST /api/reviews/workflow-callback
```

Workflow 终态回调只接受来源 `workflow` 的 Console service token（`aud=codocs`、精确 `workflow:callback`）；在读取 body 前，token 的 tenant/deployment 必须与 Tenant Gateway 注入的 `x-hzy-tenant`/`x-hzy-deployment` 完全一致。它仅对已绑定的 `instance_no` 同步 `approved/rejected/cancelled`。callback 的 actor、业务键、实例及状态以外字段均不进入 Codocs runtime；错来源、scope、tenant/deployment、业务键、未绑定或错实例一律拒绝。`approved` 保持源文档只读并等待确认发布；`rejected/cancelled` 在同一 runtime 事务中解除源文档只读状态。

认证要求：请求必须携带 Console service token，Codocs 校验 `token_use=service`、`aud=codocs`、`scope=workflow:callback` 和来源应用 `workflow`。

### 7.4 查询发布申请

```
GET /api/reviews/publish-requests/{id}
GET /api/reviews/{id}
```

`GET /api/reviews/{id}` 会优先读取新发布申请，旧 `document_reviews` 继续作为历史只读兼容。

该详情接口要求已登录且具备 `codocs:reviews:view`。Codocs BFF 会把已验证会话主体传给 tenant-runtime；tenant-runtime 每次读取时重新校验主体是否为发起人、当前节点审阅人、已产生审阅动作的历史参与者，或仍拥有有效的文档所有权、共享或 `document_relations.can_read` 关系。通知收件关系、已删除共享以及失效/撤销的文档关系均不授予详情访问权限。

`GET /api/reviews/by-document/{uuid}`、`GET /api/reviews/by-oss-path` 以及
`GET /api/reviews/publish-requests[/{id}]` 使用同一登录、`codocs:reviews:view`
和 tenant-runtime 文档读取边界；不得通过泛化资源读取绕过该校验。发布申请列表仅投影发起人、已完成的本地盖章/发送参与者，或当前有效文档 ACL 可读的记录。

`/api/reviews/{id}` 若新旧表中出现同一数值 ID，会返回 `409 review_source_ambiguous`，客户端必须改用
`/api/reviews/publish-requests/{id}` 读取新发布申请。当前 Workflow 节点审批人的 Codocs 详情读取仍待 Workflow Service 提供带签名主体和细粒度 capability 的授权查询契约；在该契约落地前，Codocs 不会猜测 Workflow 参与者或直连 Workflow 数据库。

### 7.5 审批通过后的执行链路

```
POST /api/reviews/{id}/archive
POST /api/reviews/{id}/seal
POST /api/reviews/{id}/send
POST /api/reviews/{id}/receive
```

这四个用户态接口只处理 `document_publish_requests` 中由 Workflow 审批通过的发布申请，不再写入历史兼容表 `document_reviews`。Codocs BFF 校验当前会话和应用权限，tenant-runtime 再以受信 actor、发布申请发起人、Workflow 终态、发布版本绑定和当前执行状态校验业务动作。

- `archive`：要求发起人和 `reviews:archive`。runtime 先通过内部 `archive-plan` 生成稳定发布 UUID、带发布申请 ID 后缀的无冲突 OSS 路径和初始执行状态；BFF 复制审批快照后调用 `archive` 提交，runtime 在单事务中创建只读发布文档、写源文档 `publish_info`、更新发布申请并建立协作文档关系。
- `seal`：要求 `reviews:admin`，请求体为 `{ "sealTypes": ["official"], "pageCount": 3, "remark": "..." }`。仅 `pending_seal` 且申请声明需要盖章时可执行，成功后进入 `pending_send`。
- `send`：要求发起人和 `reviews:archive`，请求体为 `{ "senderUid": "...", "receiverName": "...", "receiverPhone": "...", "channel": "email", "sentDate": "YYYY-MM-DD", "targetAccount": "...", "remark": null }`。成功后进入 `pending_receive`，并给指定发送人建立 `outside_sender` 关系。
- `receive`：要求 `reviews:view`，但 runtime 只允许发送登记中的指定发送人操作；请求体为 `{ "receiveDate": "YYYY-MM-DD" }`，日期不得早于发送日期，成功后进入 `received`。

合法状态链为：

```
approved → archived/pending_seal → pending_send → pending_receive → received
approved → archived/pending_send → pending_receive → received
```

所有 runtime 命令都会锁定发布申请并按已保存记录判断幂等重放；同一动作以不同数据重放返回 `409`，不能跳过状态。通知和审批快照清理由 BFF 在事务成功后编排，不参与数据库事实提交。部署前必须执行 `docs/migrations/20260717_workflow_publish_execution_contract.sql`；缺少执行字段或盖章/发送记录表时不得回退应用侧直连数据库。

---

## 8. 组织资产管理

以下接口使用当前登录会话和 Foundation 权限鉴权。组织资产列表和预览要求 `company:view`；移动、归档、目录维护要求 `company:admin`。管理员快速发布另要求 `admin:admin` 和 `company:publish`。部门资产列表和预览要求 `departments:view`，部门对外发文 DOCX 导出要求 `departments:export`。

### 8.1 查询管理员快速发布源

```
GET /api/company-assets/import-source?deptCode={deptCode}&folderId={folderId}&page=1&pageSize=20
```

要求 `admin:admin` 和 `company:publish`。返回 `data.departments`、`folders`、`documents` 和 `total`，仅列有效未发布部门文档，支持分页。管理员读取范围由 BFF 授权并通过受签名上下文传给 runtime，不采信浏览器自报管理员或部门权限。

### 8.2 管理员直接发布组织资产

```
POST /api/company-assets/import-documents
```

**请求体：**

```json
{
  "subdir": "rules",
  "targetPath": "业务沉淀/实施方法",
  "documentUuids": ["550e8400-e29b-41d4-a716-446655440000"],
  "operationId": "550e8400-e29b-41d4-a716-446655440001"
}
```

要求 `admin:admin` 和 `company:publish`，一次选择 1–50 份文档。`subdir` 支持 `rules/culture/legal/notices/knowledge/tech-specs/templates`。接口保留源部门文档及其编辑状态，在 `codocs/company/{subdir}/{targetPath}` 生成独立只读已发布副本；不创建审批申请、不调用 Workflow、不发送企业微信通知。

runtime 以 `operationId` 固化来源和唯一目标路径，BFF 条件写入 OSS 后回传复制证据，由 runtime 事务提交文档与操作结果。返回 `{ code: 0, data: { imported, skipped } }`；失败重试必须复用同一 `operationId` 和请求内容，已完成操作返回原结果，操作编号与不同用户或内容冲突返回 409。

组织资产「发布记录」入口仅系统管理员可见，`GET /api/reviews/by-oss-path` 对 `codocs/company/` 路径同时要求 `reviews:view` 和 `admin:admin`。快速发布投影为「直接发布记录」，展示管理员和时间，不伪造审批步骤。

### 8.3 浏览组织和部门资产

```
GET /api/company-assets/list?subdir={subdir}&path={path}
GET /api/company-assets/preview?path=codocs/company/{subdir}/{file}
GET /api/dept-assets/list?deptCode={deptCode}&subdir={subdir}&path={path}
GET /api/dept-assets/preview?path=codocs/departments/{deptCode}/{subdir}/{file}
POST /api/company-assets/export-docx
POST /api/dept-assets/export-docx
```

组织资产列表和预览在访问 OSS 目录、签名 URL 或正文内容前校验 `company:view`。组织资产 DOCX 导出仍保持禁用，但会先校验 `company:view` 再返回禁止导出。部门资产列表和预览在访问 OSS 前校验 `departments:view`；部门对外发文 DOCX 导出在读取正文和生成文件前校验 `departments:export`。

已发布 Markdown 正文禁止文字选择，PDF 使用无文字选择层的画布阅读器，保留翻页、缩放与滚动。PDF 默认预览响应的 `preview_url` 指向同源 `GET /api/company-assets/preview?format=pdf&path=...`；该模式仅接受 `.pdf` 路径，重新校验 `company:view`，从 OSS 取得字节并成功写入查看记录后返回 `application/pdf`、`Cache-Control: no-store`。JSON 元数据响应不记阅读记录，避免一次打开重复计数。浏览器无需跨域直连 OSS。

### 8.4 部门开放文档

```
PATCH /api/folders/{id}/open
GET /api/open-department-docs
GET /api/open-department-docs/{uuid}
```

`PATCH /api/folders/{id}/open` 仅允许部门负责人将部门协同文档目录设置为开放或取消开放，请求体为 `{ "is_open": true, "dept_code": "D001" }`。BFF 先使用当前登录用户和 `dept_code` 校验部门负责人身份，再向 tenant-runtime 传递受信部门管理标记；runtime 会再次核对目标目录确属该部门。开放目录下的同部门子目录和文档对所有登录用户只读可见。

`GET /api/open-department-docs` 返回各部门已开放目录的目录树和文档清单；`GET /api/open-department-docs/{uuid}` 在确认文档属于开放目录后返回 Markdown 预览内容。两个 BFF 接口统一调用 tenant-runtime 的专用 `GET /v1/codocs/open-department-documents` 合同；该合同只投影显式开放目录、其同部门后代目录及其中的有效未发布非周报文档，不放宽普通 `/v1/codocs/folders` 或 `/v1/codocs/documents` ACL。开放文档接口只要求登录态，不要求用户属于目标部门，也不授予编辑、移动、删除、发布或下载权限。

---

### 8.5 组织资产查看记录

```text
GET /api/company-assets/access-records?path={ossPath}&from=2026-09-01&to=2026-09-10&page=1&pageSize=20
GET /api/company-assets/access-records/export?path={ossPath}&from=2026-09-01&to=2026-09-10
```

查看要求 `admin:admin` + `company:admin`，导出额外要求显式 `company:export`。列表返回 `data.items/total/page/pageSize`，每项含 `id/viewerUid/viewedAt/ossPath`；界面经 Directory 显示姓名，CSV 导出姓名、用户 UID、UTC 时间与文档路径。姓名由 BFF 在导出鉴权后通过 Foundation Directory adapter 按 UID 分批查询 Console 当前姓名，不是历史姓名快照；已删除或无姓名用户显示“未匹配姓名”，UID 始终保留。目录服务异常返回可重试 503，目录鉴权失败保留 401/403。`from/to` 为可选 UTC 日期，含首尾当天；pageSize 上限 100。CSV 含 BOM 并防公式注入，单次最多 50,000 条，超限返回 413，需缩小日期范围。

组织资产预览及公司文档 UUID 正文读取，在鉴权并成功准备内容后、响应前写入 runtime 记录；元数据读取、无权限或不存在的文件不记。PDF 记录在同源 `format=pdf` 内容请求成功准备数据后写入，不代表读完文件；翻页和缩放使用已加载的 PDF，不重复请求并记数。记录写入失败返回可重试 503，不返回未记录正文。历史访问无法补录；记录按 OSS 路径归属，移动前记录保留在原路径。

上线顺序、迁移脚本和权限登记见 [组织资产管理员功能上线说明](./Company-Asset-Admin-Publishing.md)。

### 8.6 已发布文档短链接

```text
POST /api/published-asset-links                body: { "path": "codocs/company/rules/制度.md" }
GET  /api/published-asset-links/{token}
```

均要求登录；生成前校验与原预览一致的 `company:view` 或 `departments:view`，并确认 OSS 对象存在。解析短码后再次校验对应阅读权限才返回 `{ code: 0, data: { token, path } }`，不返回正文或签名下载地址。浏览器传入的 actor、marker、scope、目标 URL 均不参与授权。响应禁止缓存，生成/解析不新增查看记录。

“复制链接”按需生成 `/s/{token}`，保持当前租户域名与 Codocs 应用前缀，例如 `https://wiztek.huizhi.yun/codocs/s/AbCd01234567_-xy`。16 位短码只含 URL 安全字符，不包含中文文件名或转义 query；由 tenant-runtime 持久保存精确 OSS 路径映射，同路径重复生成返回同码，碰撞返回 409 且不覆盖。历史 OSS-only 文档无需补建 UUID。短链接阅读页沿用现有预览 API、水印和组织资产查看记录；旧的 `?path=...` 链接继续可用。短链接不自动发送通知，也不改变既有审批通知规则。

无效短码返回 400，未建立映射返回 404，无权阅读返回 403。短码不授予匿名阅读权限；文档移动、归档或删除后，旧路径对应链接不能继续读取原文，应重新复制目标文档链接。上线前须执行 `migrations/20260910_published_asset_links.sql` 并更新 runtime。

## 9. 个人统计

以下接口服务于 Codocs 前端界面，使用当前登录会话鉴权。

### 9.1 当前用户文档统计

```
GET /api/documents/stats/my
```

返回当前用户拥有的文档数量、总大小、全站文档数量/大小，以及数量占比和容量占比。统计范围为 `documents.status IN (1, 2)` 且 `deleted_at IS NULL`，不包含代码库同步文档 `doc_type = 'git-project'`。

---

## 10. 文档访问控制（Aims 跨项目组）

以下接口用于 Aims 项目文档跨项目组访问控制，策略事实源位于 Codocs。

### 10.1 访问校验

```
POST /api/v1/codocs/document-access/check
```

**请求体：**

```json
{
  "documentUuid": "0f4b...",
  "documentRefType": "codocs_document",
  "sourceApp": "aims",
  "sourceProjectCode": "PRJ001",
  "action": "view"
}
```

调用方不得传递 `actorUid`、`actorProjectCodes`、`actorDeptCodes` 或 `actorRoles` 作为授权事实。runtime 只使用 Foundation 签名并验证后注入的 actor 与部门代码；项目/角色范围待 Foundation/Console 提供绑定 data-scope delegation 前失败关闭。

**响应：**

```json
{
  "code": 0,
  "data": {
    "allowed": true,
    "permission": "view",
    "readonly": false,
    "reason": "granted_by_project",
    "lifecycleStage": "formal",
    "confidentialityLevel": "L2"
  }
}
```

### 10.2 查询访问策略

```
GET /api/v1/codocs/document-access/policies/{documentUuid}?documentRefType=codocs_document
```

返回文档当前生命周期、密级、默认权限、跨项目开关和授权白名单。

### 10.3 更新访问策略

```
PUT /api/v1/codocs/document-access/policies/{documentUuid}
```

更新策略并覆盖授权白名单（grants）。

### 10.4 查询访问审计日志

```
GET /api/v1/codocs/document-access/audit-logs?documentUuid=0f4b...
```

返回访问允许/拒绝、策略更新等审计记录。

### 10.5 文件柜预览

```
GET /api/cabinet/{uuid}/preview
GET /api/dept-cabinet/{uuid}/preview
```

用户态接口。个人/部门文件柜的列表、详情元数据、预览、文本预览、Office/PPTX 转换预览、转存信息和下载都要求当前已验证会话拥有 `documents:view`。个人柜一律以 tenant-runtime 验证后的会话 actor 为 `owner_uid`，忽略请求中的 `owner_uid`，且不会返回部门或项目柜记录。部门柜请求必须携带 `dept_code`；Codocs BFF 先验证当前用户对该部门的读取权限，再将精确部门范围放入由 actor 委托签名并覆盖完整 runtime request target 的受信上下文，runtime 仅按该上下文查询同一 `dept_code`。下载仍额外要求对应的 `documents:export` 或 `departments:export`，但导出权限不替代对象读取校验。

PDF、图片、音视频返回 OSS 内联预览签名 URL（`preview_type=direct`）；PPTX 返回服务端 PPTX 预览入口（`preview_type=pptx`）；DOC/DOCX 返回服务端 HTML 转换入口（`preview_type=office`）；TXT、CSV、JSON、XML、HTML、CSS、源码等文本类型由 Codocs 读取 OSS 内容并返回 UTF-8/GB18030/UTF-16 解码后的 `content`（`preview_type=text`，大文件仅返回前 2MB 并标记 `truncated=true`）。所有 OSS 读取或签名 URL 都在上述柜自身范围校验之后执行。暂不支持的文件返回 `previewable=false`，调用方应展示下载入口。`converted_doc_uuid` 的关联文档 ACL 是否还应作为 cabinet 自身范围之外的附加约束，尚待产品确认；本接口当前不会把该字段当作文档 ACL 继承语义。

### 10.6 文件柜上传与转文档

```
POST /api/cabinet/upload
POST /api/dept-cabinet/upload
POST /api/cabinet/{uuid}/to-document
POST /api/dept-cabinet/{uuid}/to-document
```

用户态接口。个人文件柜上传人、文件所有者和转文档操作人均取当前已验证会话 uid，不接受客户端传入的 `owner_uid`、`dept_code`、`project_code` 或 `status` 作为授权事实；runtime 仅接受 Foundation 签名 delegated actor，并以 `owner_uid + dept_code IS NULL + project_code IS NULL + status=1 + deleted_at IS NULL` 作为写入谓词。个人普通 PATCH 只允许改名或移动 `folder_id`；转文档写入 `converted_doc_uuid` 是独立 owner-bound command，不属于普通 PATCH。

部门文件柜上传、重命名、移动、删除和转文档均要求当前会话用户是目标部门经理。BFF 在经理核验后清除浏览器传入的 actor/部门 marker，并将精确部门作为 Foundation request-target 签名的 manager marker；runtime 只消费该 marker，以 `dept_code + project_code IS NULL + status=1 + deleted_at IS NULL` 约束写入，且把 `owner_uid` 固定为该会话 actor。部门普通 PATCH 只允许改名或移动 `folder_id`；转文档的 `converted_doc_uuid` 同样使用独立 manager-bound command。个人/部门删除先完成 metadata 的 `status=0 + deleted_at` 收口，再按既有行为 best-effort 把 OSS 对象移入回收站；OSS 不是数据库事务的一部分，不承诺原子回滚。

### 10.6.1 部门柜目录与部门移交的运行时边界

`GET /api/dept-cabinet/folders` 是用户态读取：必须有登录会话、`documents:view` 与目标 `dept_code` 的当前部门读取权限。BFF 会删除浏览器传入的 actor、owner、部门及已有可信标记，只将经验证的目标部门作为 Foundation 签名 request target 的 marker 传入 runtime；runtime 仅按该 marker 的 `dept_code` 查询。

`GET /api/dept-shares` 与 `PATCH /api/dept-shares/{id}` 保留既有 BFF 的 `requireRequestUid + requireDepartmentManagerAccess` 和通知编排。列表与更新均使用 BFF 在部门经理核验后写入的目标部门签名 marker；runtime 只接受签名 delegated actor，更新只允许 pending 记录进入 accepted/rejected。runtime 不把 service subject 或浏览器字段推断为部门经理。

Codocs 不再提供 `/api/reviews/templates`；发文流程定义、路由和节点统一在 Workflow 应用维护。个人 `cabinet/folders/**` 与部门柜目录的 create/update/delete 尚没有 owner/部门经理绑定的专用 runtime command，统一返回 `503 cabinet_folder_scope_contract_required`，不得退回通用资源 CRUD。

### 10.7 文档正文下载兼容代理

```
POST /api/documents/download-content
```

用户态接口。普通 Codocs 文档必须传 `uuid` / `document_uuid`，服务端会先校验 `documents:export`，再按当前会话 uid 读取 tenant-runtime 文档元数据，并要求请求体中的 `oss_path`（如传入）与元数据 `oss_path` 完全一致后才访问 OSS。前端 `app/utils/oss-client.ts` 也必须传 `documentUuid`，不再提供仅凭 `oss_path` 的下载形态。`doc_type=git-project` 的历史项目仓库文件预览必须同时传 `project_code`，服务端校验 `projects:export`，再根据 Console Directory 项目的 GitLab 仓库 URL 计算仓库 OSS 前缀，只有 `oss_path` 落在该项目仓库前缀下才允许读取。该接口不得接受缺少 UUID 或项目归属的任意 OSS path 下载。

---

## 11. 项目文件柜 Service API

面向 Aims 的非 Markdown 项目文档附件能力。调用方必须先完成自身项目成员、密级和可见范围校验，再使用 Console service token 调用 Codocs。Codocs 只负责 OSS 文件和 `cabinet_files` 元数据，不替代 Aims 的项目访问控制。

### 11.1 上传项目文件

```
POST /api/v1/project-cabinet/upload
```

认证：Console service token，`aud=codocs`、`token_use=service`、`source app=aims`、`client=aims` 或 `aims.runtime`、精确 `scope=codocs:project-cabinet:upload`。token 的 tenant/deployment 必须与请求上下文精确一致；`codocs:*`、`codocs:admin` 和 `codocs:documents:write` 均不接受。Codocs 在上述 guard 成功后清除浏览器同名项目字段，并只向 tenant-runtime 写入 request-target HMAC 覆盖的 `codocs_trusted_project_cabinet_project_code` marker。runtime 只使用此 marker 写入 `project_code`，并要求 OSS 路径严格属于 `codocs/projects/{project_code}/cabinet/`；`owner_uid` 仅为 Aims 已验证用户的审计字段，绝不由 service subject 推导。

请求：`multipart/form-data`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| owner_uid | string | 是 | 上传人 UID |
| project_code | string | 是 | Aims 项目编码 |
| dept_code | string | 否 | 项目所属部门，仅作辅助归属 |
| file | file | 是 | 非 Markdown 文件 |

响应返回上传结果、文件 UUID、OSS 路径、扩展名和大小。

### 11.2 获取项目文件下载地址

```
GET /api/v1/project-cabinet/{uuid}/download-url?project_code=PRJ001
```

认证：Console service token，`aud=codocs`、`source app=aims`、`client=aims|aims.runtime`、精确 `scope=codocs:project-cabinet:read`，tenant/deployment 与请求上下文精确一致。Codocs 仅在 guard 成功后写入受 HMAC 覆盖的项目 marker；runtime SQL 固定 `uuid + marker project_code`，不会信任浏览器 query 的 project code。

返回 5 分钟有效的 OSS 签名下载 URL。兼容历史误写入部门柜但 OSS 路径为 `codocs/projects/{project_code}/cabinet/` 的文件；调用方可传 `expected_oss_path` 进行二次校验。

### 11.3 获取项目文件预览地址

```
GET /api/v1/project-cabinet/{uuid}/preview-url?project_code=PRJ001
```

认证与 11.2 相同：精确 `codocs:project-cabinet:read`、Aims source/client 和 tenant/deployment 绑定；metadata 在签名/文本 OSS 读取前按 `uuid + marker project_code` 精确读取。

返回预览信息。PDF、图片、音视频返回 5 分钟有效的 OSS 内联预览签名 URL（`previewType=direct`）；TXT、CSV、JSON、XML、HTML、CSS、源码等文本类型由 Codocs 读取 OSS 内容并返回 UTF-8/GB18030 解码后的 `content`（`previewType=text`，大文件仅返回前 2MB 并标记 `truncated=true`）。暂不支持的文件返回 `previewable=false`，调用方应展示下载入口。

### 11.4 删除项目文件

```
DELETE /api/v1/project-cabinet/{uuid}
```

请求 body 必须包含 Aims 已验证项目文档索引的 `project_code` 与 `expected_oss_path`。认证：Console service token，`aud=codocs`、`source app=aims`、`client=aims|aims.runtime`、精确 `scope=codocs:project-cabinet:delete`，tenant/deployment 精确绑定。guard 后 Codocs 以签名 project marker 精确读取 metadata，并要求 `expected_oss_path` 与读取路径完全一致，才可移动 OSS。runtime 在同一 marker 的 `SELECT ... FOR UPDATE` 中再次锁定 `uuid + project_code`，再次比较 `expected_oss_path` 后软删除；PATCH/PUT 继续返回 `503 project_cabinet_mutation_contract_required`。

请求体或查询参数：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| project_code | string | 是 | Aims 项目编码 |
| expected_oss_path | string | 是 | Aims 项目文档索引记录的 OSS 路径；Codocs 必须校验其与锁定元数据路径一致，避免误删 |

删除顺序：先将 OSS 源文件移动到 `recycle.bin/`，再删除 `cabinet_files` 元数据。若 OSS 清理失败，接口返回错误，调用方不得继续删除 Aims 项目文档索引；若 OSS 对象已不存在，Codocs 会继续删除元数据并返回 `missingOssObject=true`。

---

## 12. Aims 必交文档质量检查

以下接口均为 service-only `POST`，只接受 Console 签发的 `aud=codocs`、来源应用 `aims`、客户端 `aims.runtime` 和对应精确 capability。Codocs 在读取 body、tenant-runtime 或 OSS 前完成 service identity 与 tenant/deployment 绑定；随后验证 method/path、request ID、operation、capability、schema、command hash 与 actor 的 one-shot HMAC。浏览器不得直接调用。

### 12.1 冻结确定版本

```
POST /api/v1/service/project-documents/{uuid}/versions/{versionId}:resolve
```

精确 capability 为 `codocs:project-document:version:resolve`。`versionId` 可为确定数据库版本 ID，也可为 `latest`；`latest` 只表示在本次调用时解析最新版本，响应始终返回确定的 `versionId + versionNum + contentSha256`。Runtime 继续以 command actor 重施 Codocs 原 owner/share/relation ACL；旧版本缺少合法 SHA-256 时返回冲突，必须先受控补算，不能无哈希送检。

### 12.2 创建评审授权

```
POST /api/v1/service/project-document-review-grants
```

精确 capability 为 `codocs:project-document:review-grant:create`。授权永久绑定 `document_uuid + document_version_id + Aims submission_no + grantee_role_code`；角色只允许 `qa` 或 `project_director`。相同绑定重试返回原 grant，不创建扩大到整份文档或后续版本的共享权限。

### 12.3 读取受检版本

```
POST /api/v1/service/project-documents/{uuid}/versions/{versionId}/review-content
```

精确 capability 为 `codocs:project-document:review-content:read`。Runtime 只接受与 `submission_no + role_code + versionId` 完全相同的有效 grant，返回内部 OSS version ID 给 Codocs BFF。BFF 按该 OSS version 读取正文并重新计算 SHA-256；与数据库快照不一致时拒绝返回。响应只含 UUID、确定版本号、标题、大小、内容哈希和正文，不暴露 OSS path、OSS version ID 或授权细节。

`document_versions.content_sha256` 对所有新版本必填；`document_review_grants` 使用外键限制，文档或版本存在质量检查引用时不能物理删除。Aims 的项目成员关系不能替代 Codocs 文档 ACL，QA 与项目总监也不能通过这些接口编辑正文。

---

## 接口优先级

| 优先级 | 接口 | 首要调用方 | 说明 |
|--------|------|-----------|------|
| **P0** | 1.1 文档摘要 | Aims | 展示关联文档标题 |
| **P0** | 1.2 批量摘要 | Aims | 工作项列表批量展示 |
| **P0** | 4.1 访问 URL | Aims | 点击跳转编辑 |
| **P1** | 1.4 搜索文档 | Aims | 关联文档时搜索选择（替代手动输入 UUID） |
| **P1** | 2.1 创建文档 | Aims | 自动生成配套文档 |
| **P1** | 11.1/11.2 项目文件柜 | Aims | 上传/下载非 Markdown 项目文档 |
| **P1** | 1.3 文档内容 | Aims | AI 需求拆解 |
| **P1** | 3.1 模板列表 | Aims | 选择模板创建文档 |
| **P2** | 6.1 AI 摘要 | Aims | 文档摘要展示 |
| **P2** | 5.1 版本列表 | Aims | 交付物版本检查 |
| **P2** | 2.2 更新元信息 | Workflow | 审批流更新 |
| **P3** | 6.2 AI 拆解 | Aims | GA 阶段 |

## 变更记录

| 日期 | 版本 | 变更内容 |
|------|------|---------|
| 2026-08-28 | 2.1 | Aims 公司周报发布分离绑定 source/target deployment，并要求 request ID 与完整 service-command HMAC；event-less drain 显式配置 Codocs target deployment。 |
| 2026-07-25 | 2.0 | 新增 Aims 必交文档确定版本解析、精确评审授权和受检版本读取；所有读取绑定内容哈希并在 OSS 返回后复算校验。 |
| 2026-07-11 | 1.7 | 明确父对象授权资源不提供 generic runtime CRUD；直达 generic `document-shares`、版本、批注/回复、问题评论路径均 fail-closed，嵌套路由保持唯一合同。 |
| 2026-07-11 | 1.9 | Aims→Codocs 项目文件柜采用精确 read/upload/delete service capability、source app/client 与 tenant/deployment 绑定；guard 后才签名项目 marker，runtime 固定 marker project SQL 与 OSS 前缀，DELETE 双重比对 expected OSS path；PATCH/PUT 继续 fail-closed。 |
| 2026-07-11 | 1.8 | 个人/部门文件柜写入改为 delegated owner / manager-bound 专用 runtime command，普通 PATCH 严格字段白名单。 |
| 2026-07-11 | 1.6 | 收紧个人/部门文件柜浏览器读取范围：个人柜绑定签名会话 actor，部门柜绑定 BFF 验证后且覆盖 runtime request target 的精确部门范围；OSS 预览/下载均在对象读取校验后执行。明确 `converted_doc_uuid` 的文档 ACL 继承语义待产品确认。 |
| 2026-06-28 | 1.5 | 新增 project-cabinet service API，支持 Aims 非 Markdown 项目文档上传/下载/在线预览/删除同步 OSS |
| 2026-06-03 | 1.4 | 新增 document-access 访问校验/策略管理/审计日志接口 |
| 2026-05-21 | 1.3 | 新增当前用户文档统计接口 |
| 2026-05-21 | 1.2 | 新增公司知识库直接导入接口 |
| 2026-05-12 | 1.1 | 新增发布申请 + Workflow 审批接口 |
| 2026-03-28 | 1.0 | 初始版本，定义 6 大类 11 个接口 |


### 发布审批传输约束（2026-09-10）

`POST /api/reviews/publish-requests` 的目录读取使用当前请求上下文，经 Console Service Binding 取得可信部门信息。`POST /api/reviews/publish-requests/{id}/workflow-instance` 在托管云中通过 `HZY_WORKFLOW_SERVICE` 直达 Workflow；目标 URL、app/deployment/prefix 来自受信 Gateway 服务目录，保留 tenant/runtime 上下文、原 actor、固定 capability、冻结命令和幂等键。缺少可信目标路由返回 503，不回退租户公网地址；成功仍须验证 receipt 后才更新 binding。接口参数、审批规则与授权范围不变。

### PC-16 产品文档读取（准备中，未开放路由）

Manifest 已声明 `codocs:product-document:read`，服务认证策略要求精确能力和 `aims.runtime` 来源。该入口委托用户 actor 并断言 AIMS 产品关系，因此以受信 AIMS 签名命令限定来源；不是通用文档读取接口。通配或旧项目正文 scope 不可替代。

领域 metadata 读取要求产品上下文、规范 UUID 和固定动作，并重新执行 Codocs owner/share/relation ACL；不携带部门授权 hint，不返回 OSS 路径或正文。目前仅完成领域方法及认证策略，Service API、Runtime 路由、JWT/HMAC 集成和 Console grant 尚未启用。

PC-16 Runtime 进展：`POST /v1/codocs/service/product-documents/{uuid}/metadata` 已接入内部 adapter，operation 为 `codocs.service.product_document.metadata`，返回 `{ success, data }`。要求精确 `codocs:product-document:read`、可信 service-command actor 与已验证的源/目标上下文；传输归类 `codocs.read`。Nuxt Service API 和 Console grant 尚未开放，不能从浏览器直接调用该 Runtime 路径。

PC-16 Nuxt Service API 已加入 `POST /api/v1/service/product-documents/{uuid}/metadata`，校验精确服务身份、租户/双 deployment、固定载荷哈希及 Foundation 签名后，使用自身 runtime 身份执行元数据 ACL 读取。返回 `{ code: 0, data: { uuid, title, doc_type, updated_at } }`，no-store；完整跨服务测试及 Console grant 尚待完成，当前不宣称部署可用。

#### 产品文档元数据授权安装产物

统一生成器 `aims/scripts/generate-product-center-grants.mjs` 已纳入 Codocs manifest 校验，输出 Console `Console-SQL-{Seed,Verify}-product-center-20260907.sql`。安装前必须有精确选择的 AIMS、Assets、Codocs 三个 active client 及有效当前凭证；新安装三项产品文档 grant，既有 Runtime read 传输权限仅核验。可通过 `@pc_codocs_client_code` 指定实际 Codocs runtime client；入站 AIMS client 仍须满足接口固定的 `aims.runtime` 受信来源。

当前完整产品中心授权清单为 165 项业务 grant、173 项核验（含 8 项传输前提）。隔离 MySQL 已验证幂等安装、无关客户端隔离及凭证失效时不授权。尚未在目标业务环境安装，发布前需实际签发 `aud=codocs` 的产品文档 read token，以及两个 Runtime audience 下 Codocs read + product-document:read 的组合 token，再执行接口联调。

#### 产品文档搜索 Runtime（Service API 待接入）

内部 `POST /v1/codocs/service/product-documents/search` 已接入，读取传输 codocs.read，精确 codocs:product-document:read。签名 operation/schema 均为 aims.codocs.product-document.search.v1，固定 command 六字段 actorUid/productCode/action=search/search/page/pageSize。目标分别验证当前actor、aims.runtime来源及源/目标deployment；按Codocs owner/share/can_read关系过滤后计数和分页，不接受部门hint。输出items四元数据字段及total/page/pageSize，不返回OSS或ACL。复用既有产品文档read grant；外部Nuxt Service路由、调用方与实际签名/JWT验收尚未完成。

搜索外部 Service API 现已接入 `POST /api/v1/service/product-documents/search`，使用上述 search.v1 签名命令及现有 product-document:read grant，无 query。精确身份与跨部署绑定在 body 前执行，hash/HMAC 在 Runtime 前执行；返回 code=0/data={items,total,page,pageSize}。每条仅 uuid/title/doc_type/updated_at。AIMS 调用方、目标部署及实际 JWT 验收尚未完成。

### 2026-09-08：产品文档正文 Service API

`POST /api/v1/service/product-documents/{uuid}/content` 由 Codocs middleware 精确分发，复用 `codocs:product-document:read`。固定 operation/schema 为 `aims.codocs.product-document.content-read.v1`，command 严格为 actorUid/productCode/documentUuid/action（content:read）；源 AIMS 签名及 tenant/双 deployment 绑定先于 Runtime 和存储。Codocs 使用自身身份与同一精确 capability 访问 Runtime，当前文档 ACL 校验后才下载正文；空 Markdown 按既有 Yjs 恢复机制处理。对外仅返回 uuid/title/docType/updatedAt/contentSize/content，不返回 OSS 路径。存储失败为脱敏503。

复用已登记 read grant，不增加 scope 或放宽现有权限。AIMS 正文调用及预览尚未接入；VM测试含真实HMAC，但身份解析、Runtime及存储为stub，不等同真实JWT/OSS验收。

### 2026-09-08：产品模板创建 Service 入口与授权产物

`POST /api/v1/service/product-documents/create` 已由 Codocs middleware 精确分发到创建处理器。入站要求 AIMS 精确 `codocs:product-document:create`；Codocs 自身访问 Runtime 使用 `codocs.write codocs:product-document:create`。Console生成产物增加AIMS→Codocs及Codocs→双Runtime的create业务授权，Codocs写传输只列前置核验、不自动扩大。

矩阵现为178条业务授权、10条传输前置要求，共188项。七项manifest/grant测试、Codocs typecheck及相关Lint通过；隔离MySQL验证188项、种子幂等、缺客户端、非选定客户端、缺传输、inactive授权与过期凭证门禁。原测试固定数量随新增组合更新：Codocs凭证失效影响8项，AIMS凭证失效影响176项、其余12项通过。未安装到真实租户，未完成实际service token组合签发探测或OSS联调。AIMS模板创建调用与UI仍待接入。

### 2026-09-08：创建回执补齐派发确认身份

创建Runtime及外部Service回执增加 operationId/operationCode/idempotencyKey/commandSchemaVersion/commandSha256，均取已验证创建信封；Service逐项与本次冻结命令比较，避免仅凭目标UUID确认另一条命令。保留原receiptId/status/target/result白名单，不外发存储路径。四项handler组合测试和创建Go专项通过，新增回执command hash不匹配拒绝，相关Lint通过。后台派发器分支尚待实现。


### ADR-018 Enterprise → Codocs 产品文档元数据

`POST /api/v1/service/assets-product-documents/{uuid}/metadata` 额外接受物理 `enterprise` / `enterprise.runtime`，仅限原 `assets.codocs.product-document.read.v1`、精确 `codocs:product-document:read`、`metadata:read` 命令。Assets 原身份继续可用，两组 app/client 必须各自匹配，不允许交叉组合。JWT 的 Codocs audience、当前授权、源部署与目标部署分别验证；HMAC 绑定 method/path/request ID、actor、productCode、UUID 及完整命令 hash。产品上下文不授予文档 ACL，Codocs Runtime 仍按当前 owner/share/relation 判断，仅返回 uuid/title/doc_type/updated_at。Aims 文档接口和正文读取不因此接受 Enterprise。

此为代码合同，目标环境 Enterprise→Codocs grant/部署与真实跨服务验收尚未完成；该 Codocs audience 能力独立于 Enterprise→Runtime 的 data-runtime 能力集合。
## Enterprise 个人文档接入候选（2026-09-19）

2026-09-20：Host `PUT /codocs/api/documents/{uuid}` 保存前新增只读 Runtime `personal-documents:update-plan`（复用精确 edit capability）。先校验当前写 ACL 与完整幂等回执，已成功同请求返回 replay，不读取或覆盖 OSS；同 key 异意图返回 409。无回执才沿既有 key 存储，之后重新取得业务权限并提交原版本/回执事务。Host body 和编辑器入口不变，详细输入与未关闭风险见 [Enterprise API](../../enterprise/docs/API_SPEC.md)。此为已完成请求重放修正，不是 OSS/数据库原子事务；未提交并发写、Collab 竞争和真实存储恢复仍阻塞写入闭环验收。未部署或修改生产对象。

目录分页补充：文件柜转存目录选择显式传 `page/pageSize=20`，显示 total、翻页、加载/错误/重试和当前选中目录；跨页保留选择，用户/租户切换清除选择。standalone `GET /api/folders` 同步返回 Runtime 的 `pageSize`（保留旧 `limit`），保留既有 401/403/503，不把授权或依赖错误统一改为 500。Host 沿用已有固定个人目录读取合同，无新增 capability。

个人柜转文档（后续增量，更新下方早期“转换待完成”的代码状态）：`POST /codocs/api/cabinet/{uuid}/to-document`，body `{title,folder_id?:number|null}`，必传有效 Idempotency-Key，不接受 query/额外字段。同时要求 documents:view/create，经精确 `codocs:personal-cabinet:create` 的 `conversion-plan`/`convert` 固定命令直达 Runtime。只读计划→读取原文件→Office 转 Markdown→条件 PUT→重新授权→Runtime 同事务创建 documents/owner relation/源文件转存关联；返回 `{success:true,data:{uuid,title}}`。源最大 100 MiB、正文最大 10 MiB；无效 DOC/DOCX 422、源对象缺失 404、状态/摘要/同 key 不同意图冲突 409、存储依赖故障 503、身份或授权失败保留 401/403。已成功重放不再存储、创建或重置关联；当前源/目标归属仍校验。原柜对象与旧文档不变，提交失败保留对象便于相同请求重试。真实 DOCX 转换在隔离测试使用原转换器；旧二进制 DOC 不以此宣称兼容。真实 DB/OSS 并发、环境授权与页面组合尚待完成。

个人柜上传：`POST /codocs/api/cabinet/upload`，multipart 字段 `files`、可选 `owner_uid`（必须本人）、可选 `folder_id`（空/null 为根目录），必传有效 `Idempotency-Key`，拒绝 query/重复及其他字段。每请求 1–30 个文件、文件字节总量最多 100 MiB，额外 multipart/表单开销最多 1 MiB；页面逐个请求保留单文件 100 MiB 与多选能力，仍受实际网关上限约束。支持原文件柜扩展名集合，Markdown 继续使用文档上传。返回 `{success:成功数,failed:失败数,items:[{filename,status,uuid?,message?}]}`；单文件错误脱敏汇总，身份/授权错误 401/403 中止。Host 固定 plan→条件 OSS PUT→commit，两次 documents:create 新鲜授权，精确 `codocs:personal-cabinet:create`；Runtime 生成稳定 UUID/完整元数据摘要路径，上传后事务复查目录与记录，重复请求不重复创建，删除/变更冲突不复活或覆盖。OSS 与数据库非原子，失败保留原请求重试；转文档与环境启用仍待完成。

个人文件柜软删除：`DELETE /codocs/api/cabinet/{uuid}`，必传 `Idempotency-Key`（8–200 位字母数字/冒号/下划线/短横线，首位字母数字），无 body/query。documents:delete 与 `codocs:personal-cabinet:delete` 分别校验；Runtime 锁定当前 actor 个人柜范围后状态与回执同事务提交。返回 `{success:true,data:{uuid,deleted:true}}`；不可见对象 404，同 key 不同文件 409，依赖故障保留真实错误。已删除重试成功，历史成功重放不重新删除恢复后的文件；保留 OSS 原 key、字节及已转存文档。转文档与环境启用仍待完成。

个人文件柜读取：`GET /codocs/api/cabinet?page=1&pageSize=20&folder_id=null` 返回 `{success,data:{items,total,page,pageSize}}`，分页上限 200。`GET /codocs/api/cabinet/{uuid}/{preview|preview-html|preview-pptx|converted-info}` 使用 documents:view 与 Runtime `codocs:personal-cabinet:read`；`download` 使用独立 documents:export/`codocs:personal-cabinet:export` 并 302 到 300 秒附件签名 URL。元数据必须为当前用户非部门/项目个人柜；浏览器不得指定其他 owner 或 OSS key。预览支持既有文本、直接媒体/PDF、Office HTML 和 PPTX 分支，Office 内容以 CSP sandbox 隔离；Office 转换失败 422，缺对象 404，存储故障 503。转存文档撤权返回 403，只有无关联/目标不存在返回 null。Host 请求级 OSS 配置隔离；standalone 列表现在也保留 total/page/pageSize。文件柜转文档写入与环境启用仍待后续闭环。

恢复前置查询：`GET /codocs/api/documents/check-name` 接 title、doc_type、folder_id、exclude_uuid，服务端 owner 绑定 actor，Runtime 使用 `personal-documents:check-name`/精确 read。省略 folder_id 等价根目录；仅个人类型，不接受部门/项目 scope。trash 支持个人 type 筛选。客户端 Host 模式不将查询故障解释为无冲突/空回收站。

个人软删除/恢复候选：`DELETE /codocs/api/documents/{uuid}` 需 documents:delete，保留原 OSS key，仅事务写回收状态与幂等回执。`POST /codocs/api/documents/{uuid}/restore` 需 documents:edit，body 仅 `{ new_title?: string }`；两者必须提供稳定 Idempotency-Key。恢复使用精确 edit 的 Runtime restore-plan/restore 固定操作，绑定当前元数据状态、提交前重验 ACL/原目录与同名冲突。原 codocs/ 对象不移动；历史 recycle.bin/ 正文及存活 Yjs 条件复制到 UUID/状态摘要隔离的新 key，不删除源文件，不覆盖现有目标。缺正文及快照返回 404，存储故障 503，计划变化/同名/同 key 异意图 409；事务与持久回执保证成功请求的迟到重放不会再次恢复随后删除的文档。新恢复动作成功清除客户端重试键，失败保留。仍需真实 DB/OSS、保留期和环境授权核验，不表示整体整合已启用。

Markdown 批量上传：`POST /codocs/api/documents/upload`，multipart 的 files（可重复）、doc_type（private/slide）、folder_id 和兼容 owner_uid（仅自身）；必填 Idempotency-Key，其他/重复标量字段拒绝。每文件 10 MiB，每批 30 文件/30 MiB，仅 UTF-8 .md；逐项返回 success/failed/items，无权限保留 401/403。复用同一 Runtime create capability 和正文条件创建，不新增代理写入域；重试保留批次键及文件顺序，前端按会话、目录、文件名与内容摘要识别同一失败批次。成功文件通过事件上下文向 Console best-effort 上报操作审计（物理 sourceApp=enterprise，action=codocs.document.upload），审计幂等键隔离租户/部署/actor/批次/序号。未启用环境 grants，不代表上传生产验收完成。

文档创建：`POST /codocs/api/documents`，必填 Idempotency-Key，title，支持 private/slide、folder_id、content（UTF-8 不超过 10 MiB）；兼容 owner_uid 只能等于当前 actor。经 documents:create 和精确 `codocs:personal-documents:create` 直达 Runtime，稳定 UUID + 规范请求摘要支持重试，字段或内容冲突 409。元数据及 owner relation 复用原领域事务；初始正文条件写入，不覆盖已有正文，存储失败 503 后可使用相同 key 和 payload 修复。目录在事务内校验归属，API 不接受任意 UUID/存储路径/项目部门归属。此为创建候选，不包含上传或正文覆盖。

创建目录：Host `POST /codocs/api/folders` 要求 `Idempotency-Key`，支持 private/slide；服务端派生 owner，精确 Runtime capability `codocs:personal-folders:create`，回执和创建同事务，重放重验权限、不同内容返回 409。详情读取候选可读取正文/恢复 Yjs，`skip_content=1` 仅取元数据。带 event 的 OSS 配置按请求隔离，不进入全局缓存。

正文下载：`GET /codocs/api/documents/{uuid}/download` 要求 documents:export 及 Runtime `codocs:personal-documents:export`，返回 UTF-8 Markdown 附件。company 对象在返回正文之前经 Host 内部 `document-access-records:record` 合同记录访问，精确能力 `codocs:document-access-records:record`；仅接受 eventId 与 pathSha256，Runtime 重验 UUID 当前 ACL 和对象路径摘要，不以传入路径授权。读取使用 view、下载使用 export 的当前权限，审计失败返回脱敏 503 且不交付正文；元数据-only、非 company 路径及存储失败不记录。未开放浏览器审计写入口，也未启用环境授权。

审计依赖故障映射 503；授权失效保留 401/403，存储路径变更保留 409，错误消息脱敏且不交付正文。

目录详情/修改/删除新增：`GET/PATCH/DELETE /codocs/api/folders/{id}` → `POST /v1/enterprise/codocs/personal-folders:{view|update|delete}`，分别精确 read/edit/delete。PATCH 字段仅 name/parent_id；个人 owner 由签名 actor 校验，目录移动不能跨 namespace 或形成循环，非空目录（包含回收站文档）删除返回 409。此候选未启用真实环境；创建接线见上文，真实数据库并发验证尚待完成。

新增元数据候选：`PATCH /codocs/api/documents/{uuid}` 接受 `title/folder_id/star_flag/home_flag/readonly_flag`，经 `documents:edit` 和精确 Runtime capability `codocs:personal-documents:edit` 调用 `personal-documents:edit-metadata`。保留已有 OSS key；正文替换、对象回收与恢复另行编排，不能传入任意 OSS path 或修改文档 owner/type。Runtime 对目标目录、只读状态及原文档 ACL 继续验证。

Host 新增 `/codocs/api/documents`、`/codocs/api/documents/{uuid}`、`/codocs/api/documents/trash`、`/codocs/api/folders` 的 GET 候选。它们通过物理 Enterprise 身份、逻辑 Codocs `documents:view` 和精确 `codocs:personal-documents:read` 调用 Runtime 的 `POST /v1/enterprise/codocs/personal-documents:{list|view|trash|folders}`，不转发到独立 Codocs HTTP 服务，也不更换 Codocs DB。Runtime 要求签名 actor、当前 service grant、绑定租户/部署的短 permit，并复用现有文档 ACL。

`GET /codocs/api/documents` 的既有 `search` 查询参数现在按文档标题过滤（与当前 actor 可见性、个人类型及分页条件合取），供 Enterprise 产品资料关联选择器使用；关键词最多 100 个 Unicode 字符，`%`、`_`、反斜杠均按字面字符匹配；未传或空白时保持原列表行为。选择器也可读取已有的 `/codocs/api/collab-docs?category=shared&scope=all&keyword=...` 作为共享文档来源。两种列表只提供候选 UUID/标题，最终关联仍由 Aims/Assets/Codocs 原有权限链重验，不因候选可见自动取得正文权限。

这些候选不表示附件与完整 mydocs 动作已经接通。页面注册、其余写入/共享/日志周报/演示、权限目录组合和环境启用仍在实施中；未进行本轮页面验证。完整合同见根 `docs/MODULE_CONTRACTS.md` 的“Enterprise 个人文档接入候选”。
## 未启用的文档快照事务（2026-09-20）

Runtime 内部新增候选准备/发布方法、受权已发布引用读取方法及 `document_snapshot_heads`、`document_snapshot_candidates`，尚未注册 HTTP API、安装目标 schema 或接入 Host/Collab。仅处理 private 文档内容；generation/epoch、当前 owner/write-share、精确对象版本、配对引用和幂等发布规则见[写入协调合同](../../docs/Codocs-Document-Write-Coordination.md)。现有保存/读取 API 不因该内部增量改变；正式存储校验器、全部读者和旧 writer 切换均是放行前置条件。
## Enterprise Host v2 协作会话（2026-09-24 候选）

`POST /codocs/api/documents/{uuid}/collaboration` 不接受 query/body，由 Host 当前用户身份与 Codocs `documents:edit` 授权打开 Runtime `personal-documents:collaboration-open`（精确 `codocs:personal-documents:edit`）。只有 `HZY_ENTERPRISE_CODOCS_SNAPSHOT_V2` 与 `HZY_ENTERPRISE_CODOCS_COLLABORATION_V2` 均为 `true` 才登记；关闭时 404，缺权限 403，Runtime/授权依赖故障保留 503。成功返回 `{success:true,data:{token:"v2.<一次性票据>",sessionId,expiresAt}}`，并设 `Cache-Control: no-store`。票据每次连接重新领取，Collab 兑换后不能重放；Host 共享私人文档正文只经 Collab 发布，不经普通 PUT。环境与双人验收尚未完成，见[协调合同](../../docs/Codocs-Document-Write-Coordination.md)。

阶段 B 的 Collab → Runtime 对象字节路由均为 `POST`，仅在 Runtime `snapshotV2Enabled` 和 `collaborationV2Enabled` 同时开启时登记。`:upload` 使用 `codocs:collaboration-snapshots:publish`，请求为 `{sessionId,generation,epoch,markdownSha256,markdownSize,yjsSha256,yjsSize,attempt,part,contentBase64}`，并带 `Idempotency-Key`；`attempt` 为 32 位小写十六进制，`part` 为 `markdown|yjs`。Runtime 要求活动会话、已 prepare 且命令摘要匹配的候选，核对本次字节长度与 SHA-256，仅在其前缀下写一次上传，返回 `{key,version}`。`:download` 使用 `codocs:collaboration-snapshots:read`，请求 `{sessionId,part}`，只按该会话文档的当前已发布 head 返回 `{key,version,size,sha256,contentBase64}`，重验精确版本及内容。两路由都要求 `collab.runtime` 的精确服务身份和 active grant；每对象最多 16 MiB，Markdown 仍受命令层 10 MiB 上限。Collab 不接收 OSS 凭据；字节由 Runtime 使用 vault 绑定的 `oss.default` 读写。未部署、未做双人端到端验收。
