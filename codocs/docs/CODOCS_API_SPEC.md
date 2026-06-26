# Codocs 模块间 API 规范

版本：1.5
日期：2026-06-16
状态：DRAFT

## 概述

Codocs 对外提供的 RESTful API，供汇智云平台其他模块（Aims、Workflow、Altoc 等）调用。当前 `/api/v1/documents/**` 服务接口由 Codocs Nuxt BFF 完成鉴权、OSS 内容读写和响应兼容，文档元数据、搜索、批量摘要、创建记录等数据访问必须通过 tenant-runtime 的 `/v1/codocs/**` 合同完成，不再直连 Codocs DB。

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
| 401 | 认证失败（API Key 无效） |
| 403 | 无权限访问该资源 |
| 404 | 资源不存在 |
| 409 | 资源冲突（如重复创建） |
| 500 | 服务端错误 |

---

## 0. 运维知识关联

### 0.1 关联运维知识上下文

将已有 Codocs 文档 UUID 标记为运维知识，并通过 `document_relations` 关联客户、合同、项目、交付实例和服务工单上下文。接口只写文档关系索引，不写业务模块主档，也不复制文档正文。

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
  "ticketCode": "ST-2026-001",
  "artifactType": "ops_knowledge",
  "actorUid": "zhangsan"
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
    "relatedUid": "zhangsan",
    "linkedCount": 4
  }
}
```

**调用方：** Altoc（服务工单复盘 / 知识归档）、Assets（交付实例运维手册 / 客户环境记录归档）。

---

## 1. 文档查询

### 1.1 获取文档摘要信息

获取文档的基本信息（不含正文内容），适用于其他模块展示关联文档的标题、状态等。

```
GET /api/v1/documents/{uuid}/summary
```

**请求参数：** 无

**响应：**

```json
{
  "code": 0,
  "data": {
    "uuid": "550e8400-e29b-41d4-a716-446655440000",
    "title": "汇智云项目PRD V1.0",
    "docType": "project",
    "ownerUid": "zhouguangying",
    "ownerName": "周光营",
    "deptCode": "HW",
    "projectCode": "huizhi-yun/aims",
    "status": 1,
    "contentSize": 24576,
    "aiAbstract": "本文档描述了汇智云项目管理模块的产品需求...",
    "lastEditorUid": "zhouguangying",
    "lastEditorName": "周光营",
    "createdAt": "2026-03-20T10:00:00.000Z",
    "updatedAt": "2026-03-28T15:30:00.000Z"
  }
}
```

**调用方：** Aims（展示工作项关联的文档信息）、Workflow（审批流附件预览）

---

### 1.2 批量获取文档摘要

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

创建 Codocs 本地发布申请、复制审批快照、锁定源文档，并返回 `workflowLaunchPayload`。该接口不直接创建 Workflow 实例，前端需使用返回的 payload 调用 Workflow `prepare/create`。

### 7.2 绑定 Workflow 实例

```
POST /api/reviews/publish-requests/{id}/workflow-instance
```

Workflow 实例创建成功后回写 `workflow_instance_id`、`workflow_instance_no` 与初始状态。

### 7.3 Workflow 终态回调

```
POST /api/reviews/workflow-callback
```

Workflow 终态回调同步 `workflow_status`。`approved` 保持源文档只读并等待确认发布；`rejected/cancelled` 会解除源文档只读。

认证要求：请求必须携带 Console service token，Codocs 校验 `token_use=service`、`aud=codocs`、`scope=workflow:callback` 和来源应用 `workflow`。

### 7.4 查询发布申请

```
GET /api/reviews/publish-requests/{id}
GET /api/reviews/{id}
```

`GET /api/reviews/{id}` 会优先读取新发布申请，旧 `document_reviews` 继续作为历史只读兼容。

---

## 8. 公司知识库管理

以下接口服务于 Codocs 组织资产后台界面，使用当前登录会话鉴权。调用方必须具备 `company:admin` 权限。

### 8.1 查询知识库导入源

```
GET /api/company-assets/import-source?deptCode={deptCode}&folderId={folderId}
```

返回部门树、指定部门的目录树，以及当前部门/目录下可导入的部门文档。该接口面向系统管理员，读取部门文档时不受普通部门成员权限限制。

### 8.2 直接导入公司知识库

```
POST /api/company-assets/import-documents
```

**请求体：**

```json
{
  "subdir": "knowledge",
  "targetPath": "业务沉淀/实施方法",
  "documentUuids": ["550e8400-e29b-41d4-a716-446655440000"]
}
```

接口会将选中的部门文档复制到 `codocs/company/knowledge/{targetPath}`，创建 `documents` 已发布记录，并将源部门文档标记为已发布/只读；该路径不创建发布申请，也不触发 Workflow 审批。

---

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
  "action": "view",
  "actorUid": "u001",
  "actorProjectCodes": ["PRJ001", "PRJ002"],
  "actorDeptCodes": ["RD"],
  "actorRoles": ["project_member"]
}
```

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

---

## 接口优先级

| 优先级 | 接口 | 首要调用方 | 说明 |
|--------|------|-----------|------|
| **P0** | 1.1 文档摘要 | Aims | 展示关联文档标题 |
| **P0** | 1.2 批量摘要 | Aims | 工作项列表批量展示 |
| **P0** | 4.1 访问 URL | Aims | 点击跳转编辑 |
| **P1** | 1.4 搜索文档 | Aims | 关联文档时搜索选择（替代手动输入 UUID） |
| **P1** | 2.1 创建文档 | Aims | 自动生成配套文档 |
| **P1** | 1.3 文档内容 | Aims | AI 需求拆解 |
| **P1** | 3.1 模板列表 | Aims | 选择模板创建文档 |
| **P2** | 6.1 AI 摘要 | Aims | 文档摘要展示 |
| **P2** | 5.1 版本列表 | Aims | 交付物版本检查 |
| **P2** | 2.2 更新元信息 | Workflow | 审批流更新 |
| **P3** | 6.2 AI 拆解 | Aims | GA 阶段 |

## 变更记录

| 日期 | 版本 | 变更内容 |
|------|------|---------|
| 2026-06-03 | 1.4 | 新增 document-access 访问校验/策略管理/审计日志接口 |
| 2026-05-21 | 1.3 | 新增当前用户文档统计接口 |
| 2026-05-21 | 1.2 | 新增公司知识库直接导入接口 |
| 2026-05-12 | 1.1 | 新增发布申请 + Workflow 审批接口 |
| 2026-03-28 | 1.0 | 初始版本，定义 6 大类 11 个接口 |
