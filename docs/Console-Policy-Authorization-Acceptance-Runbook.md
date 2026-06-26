# Console 权限消费验收运行手册

对应 Implementation Backlog 的 E8-T16 / E8-T23 / E8-T24。

本手册描述从 Platform 角色授权到 Console 权限消费的端到端验收流程：

```text
Platform 全局角色 -> 物化到租户 -> 授权 user subject -> 生成 policy bundle
  -> Console 拉取并缓存 bundle -> /api/auth/permissions / requirePermission
  -> 前端菜单过滤 / 路由守卫
```

服务端链路由两个脚本自动验收；菜单过滤和路由守卫属于前端行为，按第 4 节手工核对。

## 1. 前置条件

- Platform 与 Console 均已启动，目标租户已完成激活（activation），Console 能拉取签名 bundle。
- 一个 tenant owner 身份的 Platform Dashboard 账号（生成 bundle 的 API 仅 owner 可调用）。
- 一个测试用户：
  - 已投影到 Platform `tenant_subjects`（`subjectType=user`，`subjectCode=uid`）；
  - 能登录 Console（拿到 `console_session` cookie）。
- 可选：一个不授予目标角色的对照用户，用于反向验证。
- 验收环境不得开启 `HZY_CONSOLE_DEV_POLICY_BYPASS`（dev bypass 会返回全量权限，使验收失真）。

## 2. Platform 授权链路验收（E8-T23）

```bash
export PLATFORM_ACCEPT_EMAIL='owner@example.com'
export PLATFORM_ACCEPT_PASSWORD='...'

pnpm run accept:platform-policy-roles -- \
  --base-url http://127.0.0.1:3011 \
  --tenant-code <tenantCode> \
  --subject-code <测试用户uid> \
  --role-code system_admin \
  --email-env PLATFORM_ACCEPT_EMAIL --password-env PLATFORM_ACCEPT_PASSWORD
```

脚本依次断言：

1. 全局企业角色存在（默认 `system_admin`，见 `HZY-Platform-SQL-Seed-v2.16-enterprise-roles.sql`）；
2. `system-roles/{code}/enable` 物化成功；
3. 角色出现在租户可分配角色列表；
4. `subject-roles` 授权写入成功；
5. 生成的 bundle payload 中 `roles / subjectRoles / rolePermissions / subjects` 包含对应数据。

也可用 `--cookie-env` 直接传浏览器会话。验收最小权限场景时，可改用仅映射
`console:viewer` 的角色（如 `general_manager`），此时 Console 侧资源校验
对应 `org_profile:view` 这类只读权限。

## 3. Console 拉取新 bundle

bundle 生成后 Console 不会立即感知，按部署形态选择一种方式让 Console 拿到新版本：

- 等待下一次 heartbeat 返回 `download_bundle` action（自动拉取）；
- 重启 Console 实例（启动时存在缓存会主动刷新）；
- Cloudflare `managed-cloud-multitenant` 形态在鉴权 cache miss 时自动按租户 scope 拉取。

确认方式：`/api/activation/diagnostics`（需 diagnostics token）或下一节脚本输出的权限快照是否生效。

## 4. Console 权限消费验收（E8-T24 + E8-T16 服务端）

浏览器登录 Console 后，从 DevTools 复制 `console_session` cookie 值：

```bash
export CONSOLE_ACCEPT_COOKIE='console_session=...'
# 可选，对照用户
export CONSOLE_ACCEPT_DENIED_COOKIE='console_session=...'

pnpm run accept:console-policy-consumption -- \
  --base-url http://127.0.0.1:3000/console \
  --cookie-env CONSOLE_ACCEPT_COOKIE \
  --denied-cookie-env CONSOLE_ACCEPT_DENIED_COOKIE \
  --resource org_profile --action view
```

脚本断言：

1. 未登录 `/api/auth/permissions` 返回 401；
2. 已授权用户快照包含 `org_profile:view`（`view/edit/admin` 向下包含）；
3. 已授权用户可访问 `requirePermission` 保护接口（默认 `/api/v1/console/business-domains`，对应 `org_profile:view`）；
4. 未登录访问受保护接口被拦截；
5. 对照用户无目标权限且受保护接口返回 403。

`--base-url` 必须带 Console 的 app base path（默认 `/console`）。

## 5. 前端手工核对清单（E8-T16 UI 部分）

前端 `usePermissions()` 与路由守卫消费的就是第 4 节验证过的 `/api/auth/permissions`
响应，此处核对 UI 行为本身：

- [ ] 以授权用户登录 Console，左侧菜单仅显示其权限范围内的入口；
- [ ] 直接访问有权限页面（如企业资料）正常渲染；
- [ ] 以对照用户登录，受控菜单项不显示；
- [ ] 对照用户直接输入受控页面 URL，被路由守卫拦截（跳转无权限提示页或首页，而非渲染后报错）；
- [ ] 在 Platform 调整角色授权并重新生成 bundle，Console 拉取新 bundle 后（必要时重新登录刷新快照）菜单与路由行为随之变化；
- [ ] 全程无静默放权：bundle 缺失/未激活时权限 API 返回明确错误（`reason=bundle_unavailable` 等），而不是空权限放行。

## 6. 验收记录

每次执行后在下表追加一行（脚本输出含 bundleVersion，可直接引用）：

| 日期 | 环境 | 租户 | 角色 | bundleVersion | 脚本结果 | UI 清单 | 执行人 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | |
