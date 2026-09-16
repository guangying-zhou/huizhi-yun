# Codocs 曹倩新建文件夹 403 与刷新 400 修复记录

日期：2026-07-26  
租户：C000001 / wiztek.huizhi.yun  
状态：DEPLOYED_PENDING_CAOQIAN_ACCEPTANCE

## 现象

曹倩在 Codocs「我的文档」创建文件夹时，`POST /codocs/api/folders` 返回 403。
同一时间段还出现 `POST /codocs/api/auth/refresh` 返回 400：

- 文件夹请求 Cloudflare ray/requestId：`a2182b0cfc122f5d`
- 刷新请求 Cloudflare ray/requestId：`a2182d2bf86009cf`
- 旧 Codocs Worker version：`eec9c80e-c1ed-4487-8077-22275fc8306a`

日志中的关键消息：

- `Console authorization unavailable; business applications no longer fall back to local policy bundle`
- Console `/oauth/token` 返回 `invalid_grant: session revoked or expired`

## 生产证据与根因

生产 Console 数据表明：

- 曹倩账号 `caoqian` 为 active。
- 文件夹报错前几秒，Codocs 对曹倩的 token introspection 成功。
- 当前 Codocs policy bundle 包含曹倩 subject，并授予基础 `documents:create`。

因此 403 不是用户缺权。根因有两层：

1. Foundation 的普通权限快照、scoped authorization 和实例冲突解释仍用 `$fetch`
   访问 Console 公网地址，没有复用已配置的
   `HZY_CONSOLE_SERVICE -> hzy-console-prod` Service Binding。跨 Worker 请求间歇失败后，
   Codocs `checkPermission` 又将 Console 503 吞掉并返回 `false`，最终伪装成用户缺权 403。
2. refresh token 已失效时，Console 返回的 `invalid_grant` 位于嵌套
   `error.code/error.message` 结构。原解析器只检查浅层字段，未识别为需要重新登录，
   因而把预期的会话过期流程暴露成未处理 400。

## 修复

- Foundation 授权客户端检测到 Cloudflare Console binding 时，普通权限快照、
  scoped authorization 和实例冲突解释全部通过统一 Service Binding helper 请求。
- Service Binding 请求统一去除租户 Gateway 使用的 `/console` 前缀。
- Codocs `checkPermission` 不再吞掉授权依赖异常；Console 不可用保持 503，
  真实权限不足才返回 403。
- OIDC refresh 错误诊断递归读取嵌套 `message/statusMessage/error/code/data`，
  `invalid_grant` 现在返回：
  `200 { ok: false, reauthenticationRequired: true, reason: "session_expired_or_revoked" }`，
  由前端进入正常重新登录流程。
- 在根级 `CLAUDE.md` 与 Foundation 能力文档中固化防错规则。

## 验证

- Foundation tests：276/276
- Codocs tests：150/150
- Foundation lint/typecheck：通过
- Codocs lint/typecheck：通过
- 新增回归覆盖：
  - 三类授权请求都命中 Service Binding，且不会回落到公网 `$fetch`
  - `/console` 前缀被移除
  - 嵌套 `invalid_grant` 被识别为重新登录
  - Codocs 不将授权依赖失败转换成权限拒绝
- `https://wiztek.huizhi.yun/codocs/`：HTTP 200
- `https://codocs.huizhi.yun/codocs/`：HTTP 200
- 未登录 `/codocs/api/auth/me`：HTTP 200，返回正常 unauthenticated 状态

## 部署

- Codocs Worker version：`0f77e633-240d-4021-a8cd-e2ede9e68580`
- 发布时间：`2026-07-27T02:35:57.804Z`
- 流量：100%
- Cloudflare binding：`HZY_CONSOLE_SERVICE (hzy-console-prod)`

## 待完成验收

需要曹倩刷新页面或重新登录后，再创建一个个人文件夹。验收标准：

1. `POST /codocs/api/folders` 返回 200；
2. 不再出现 `Console authorization unavailable`；
3. 若旧 refresh token 已撤销，页面完成一次正常重新登录，不再出现未处理 400。

Foundation 修复会被所有业务应用复用，但本次只重新部署 Codocs。Aims、People、
Workflow 工作区包含尚未独立交付的项目治理/绩效改动，不应为本问题盲目重建并带入生产；
应在这些应用各自的下一次受控发布中带上该 Foundation 修复。
