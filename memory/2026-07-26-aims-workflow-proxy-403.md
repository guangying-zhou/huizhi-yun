# Aims 项目概览 Workflow Proxy 403 排障记录

- 日期：2026-07-26
- 状态：DONE
- 生产版本：Aims `5e2ddc41-41fe-4f48-a11f-f80424c8ae59`

## 现象

Aims 项目 33 概览页查询项目立项、暂停、恢复和结项流程时，以下请求返回 403：

`GET /aims/api/workflow-proxy/instances/by-biz`

## 根因

生产 Aims `4aeef34a-34dc-45a4-876f-7a9d5036b49d` 的 Workflow 代理只把下游 `x-hzy-app-code` 改成了 `workflow`，仍保留来源 `C000001-aims` deployment。Workflow 随后以自己的 `workflow.runtime` 身份查询当前 `project_director`，Data Runtime 发现 app、client 与 deployment 不是同一个精确 runtime client，拒绝签发 Console token：

`service token deployment requires an exact runtime client`

生产 Console v1.26 verify 同时证明 `aims.runtime` credential、`workflow:proxy` 和 `workflow:action_defs:sync` 均为 active，因此本次并非 grant 缺失。

## 修复

Foundation Workflow proxy 通过 `trustedServiceRequestHeaders(event, 'workflow')` 从 Tenant Gateway 的受信 route catalog 原子改写：

- `x-hzy-app-code=workflow`
- `x-hzy-deployment=C000001-workflow`
- `x-forwarded-prefix=/workflow`

未降低 Data Runtime 的精确 runtime-client 校验，也没有吞掉 403。

根级 AI 规则新增约束：跨 Worker 直达必须同时改写 app、deployment、base path，并用契约测试覆盖三个字段。

## 验证

- Foundation 测试：275/275 通过。
- Aims 测试：218/218 通过。
- Foundation、Aims lint/typecheck 通过。
- Aims Cloudflare build、Wrangler dry-run 和正式部署通过。
- 部署确认 `HZY_CONSOLE_SERVICE (hzy-console-prod)`。
- 已登录生产页面 `https://wiztek.huizhi.yun/aims/projects/33` 重新加载后：
  - 页面成功显示项目概览；
  - 浏览器控制台 error 为 0；
  - Aims 和 Workflow 实时日志中 initiation、finish、resume、pause 及历史查询全部为 `Ok`；
  - 不再出现 `service token deployment requires an exact runtime client`。

构建环境提示本机 Node `25.8.1` 高于仓库声明的 `<25`，但全部门禁均通过；后续日常开发仍应使用仓库要求的 Node 24.18.x。
