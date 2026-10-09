# Wiztek 过渡页

用户批准于 2026-10-07。独立静态 Worker 只接管 `wiztek.huizhi.yun/*`；旧 `hzy-tenant-gateway`、`*.huizhi.yun/*` 和 DNS 保持原样。HTML 来自 Astra 的员工指南任务，主入口为 `https://aidcp.wiztek.cn`，附带同目录完整指南。

## 发布与核验

```sh
node --test deploy/cloudflare/wiztek-transition/worker.test.mjs
pnpm --dir enterprise exec wrangler deploy --config ../deploy/cloudflare/wiztek-transition/wrangler.jsonc
```

正式发布前冻结现有路由清单及两个 HTML 的 SHA-256。发布后回读路由：仅新增 `wiztek.huizhi.yun/* → hzy-wiztek-transition`，既有路由逐字段一致；检查 HTTP/HTTPS、员工指南、手机布局及主按钮目标。

## 回滚

删除本次新增的精确 Worker route（用发布回读记录的 route ID 调用 Cloudflare 正式 DELETE API）。请求自动回到既有通配网关。不要删除旧网关、修改通配路由或 DNS。

## 管理员归档入口

2026-10-07 用户裁定另设不易猜测的子域，依赖旧系统自身登录，不加 Access，不做写过滤，不公开宣传，不在本过渡页放链接。正式登记精确租户别名与 OIDC 回调；仅停用已查清归属的旧 tenant/runtime cron，不盲停共享 Console。登录和后台归属需核实后才可启用，不把隐蔽地址当作安全边界。

## 发布记录

2026-10-07：制品 `090a5722` 已部署，Worker版本 `006c5cda-3cbd-4b5e-9371-f20bea9721cb`。初次因既有 Access 拦截而删除新增路由回滚。用户删除该 Access 应用后，恢复精确路由并完成 HTTP/HTTPS、完整指南与线上1440/390布局/按钮导航验收；原三条路由保持不变。后续回滚仍只删除新增精确路由。受保护执行记录位于 `.git/report-wiztek-transition-20261007.md`。
