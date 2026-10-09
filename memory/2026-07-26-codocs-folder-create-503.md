# Codocs 新建文件夹 503 修复记录

日期：2026-07-26  
租户：C000001 / wiztek.huizhi.yun  
状态：DEPLOYED_PENDING_BROWSER_ACCEPTANCE

## 现象

在 Codocs「我的文档」页面创建名为“测试”的个人文件夹时，
`POST /codocs/api/folders` 返回 HTTP 503。

## 生产证据与根因

Data Runtime 审计日志记录：

- 时间：`2026-07-27T01:40:41.78409614Z`
- requestId：`7261c646adf3b587aa7afda42377a240`
- resource：`/v1/codocs/folders`
- status：`503`
- errorCode：`folder_scope_contract_required`

Codocs tenant-runtime 迁移只实现了按受信 actor 过滤的文件夹列表和部门开放状态写入。
为避免 generic table mutation 越权，adapter 将普通文件夹 detail/create/update/delete
统一失败关闭；但生产 UI 仍保留新建目录入口，导致安全过渡状态直接暴露为 503。
同时，Codocs middleware 曾直接转发 `POST /api/folders`，会绕过本地 BFF 已有的部门
负责人校验。

## 修复

- 新增 `POST /v1/codocs/folders` 专用创建合同：
  - 只接受 Foundation 签名 actor。
  - `private` 目录始终把 owner 绑定到受信 actor，忽略调用方伪造的 owner/部门/项目。
  - `department` 目录要求 BFF 已核验并签名的精确部门经理范围，runtime 再次比对
    `dept_code`。
  - 子目录创建重新读取父目录，要求类型、owner、部门、项目命名空间完全一致。
  - `project`、`slide`、`publish` 仍保持失败关闭，直到各自来源范围合同落地。
- `POST /api/folders` 改回本地 BFF 编排：
  - 在读取 body 前要求当前会话和 `documents:create`。
  - 部门目录先执行部门负责人校验，再向 runtime 传递受信管理部门 marker。
- 保留 folder detail/update/delete 的失败关闭，不恢复 generic CRUD。
- 更新 Codocs API、Tenant Runtime API 合同和根级 AI 规则。

## 测试

- 先增加回归测试并确认旧代码失败：
  - private create 返回 `folder_scope_contract_required`
  - department create 未进入专用 operation
- 修复后：
  - Data Runtime `go test ./...` 全部通过。
  - Codocs lint 通过。
  - Codocs typecheck 通过。
  - Codocs tests：149/149。
  - Codocs Cloudflare build 和 dry-run 通过。

## 部署

- Data Runtime：
  - version：`0.3.151`
  - builtAt：`2026-07-27T01:52:51Z`
  - sha256：`9ad2c27094438ec28814a2c92597ca23bdcacd0b4e1a01d0289f867ebe5a85db`
  - 旧二进制备份：
    `/opt/hzy-data-runtime/hzy-data-runtime.before-0.3.151-20260727T015251Z`
  - 部署后 `/runtime/healthz` 返回 `status=ok`，Codocs DB 为 `ok`。
- Codocs Worker：
  - version id：`eec9c80e-c1ed-4487-8077-22275fc8306a`

## 待完成验收

自动化浏览器的 Codocs 登录会话已过期；Chrome 同样停在 Wiztek SSO 登录页，未读取或
代填用户凭证。因此还需用户完成一次登录后，通过真实页面创建“测试”目录，并核对最新
Data Runtime 日志为 `codocs.folders.create` / HTTP 200，且不再出现
`folder_scope_contract_required`。
