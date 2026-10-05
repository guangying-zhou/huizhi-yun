# 2026-07-18 AIMS 项目总览业务领域 401

## DEBUG REPORT

- Status: DONE
- Symptom: AIMS 项目总览请求 `GET /aims/api/directory/business-domains` 返回 401，控制台记录 `Failed to fetch business domains`。
- Root cause: Foundation 目录代理调用 Console 业务领域接口时没有携带浏览器事件上下文；原有回退接口同样依赖 Console 人员权限。项目成员不应因此获得 Console 人员角色，正确边界应为 AIMS BFF 使用精确服务能力访问 Console 服务接口。
- Fix:
  - Foundation 新增业务领域服务读取方法，使用 AIMS 服务身份和 `console:business-domain:view` 精确能力。
  - Console 新增仅允许已绑定服务身份访问的 `/api/v1/console/service/business-domains`。
  - Console 中间件仅为该服务路由开放精确服务令牌认证。
  - 移除 AIMS 业务领域读取对 Console 人员接口和旧目录接口的回退。
  - 为生产 `aims.runtime` 身份授予 `console:business-domain:view`，未增加任何 Console 人员角色权限。
- Contract coverage:
  - Foundation 目录服务请求合同测试通过。
  - Console 服务路由、能力和来源绑定合同测试通过。
  - Foundation 222 项测试、Console 372 项测试、AIMS 194 项测试全部通过。
- Deployments:
  - Console Worker: `320c9e12-3089-449d-9f23-83779a33e204`
  - AIMS Worker: `ef80f994-49af-450d-9873-95ca709dee74`
- Production verification:
  - 2026-07-18 21:01 ADT 使用已登录浏览器刷新 AIMS 项目总览。
  - Cloudflare 实时日志确认 `GET /aims/api/directory/business-domains` 为 `Ok`。
  - Cloudflare 实时日志确认 `GET /api/v1/console/service/business-domains` 为 `Ok`。
  - 刷新后新增浏览器控制台错误为 0；唯一一条业务领域 401 的时间为部署前 `2026-07-18T23:51:45.659Z`。
