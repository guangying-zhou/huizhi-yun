# Cloudflare 业务应用 OIDC callback 503 调试报告

日期：2026-07-18  
租户：C000001 / wiztek.huizhi.yun

## 结论

本次 503 不是 PM2 或 Console 进程故障。Console 与各业务应用均部署为
Cloudflare Worker；故障发生在租户 Gateway、业务 Worker、Cloudflare Console
Worker 与 Tenant Runtime 之间的认证上下文传递链路。

修复已发布到生产 Worker，两个租户 Console 数据库均已补齐 Runtime 授权。
真实浏览器登录和 Worker tail 验证表明：

- Codocs OIDC callback、会话、权限、目录、部门文档列表、通知与反馈设置请求正常。
- Finance OIDC callback、会话、权限、目录、仪表盘、通知与反馈设置请求正常。
- AIMS、Workflow、Altoc、WebDev 均进入应用工作台。
- People 正确进入角色无权限页，不再出现 503。
- Assets Worker 的认证、权限、目录、分类、仪表盘、通知、反馈设置、心跳均为 200。

## 根因

1. Tenant Gateway 只为 Console 路由签发 Platform Runtime bootstrap token，业务应用
   API 路由没有获得同一租户 Runtime 上下文。
2. Foundation 的 Console OIDC、JWKS、session bridge、permission snapshot、directory、
   applications、notifications、runtime settings 等直连客户端没有完整转发 Runtime
   URL、租户代码、bootstrap token 与 audience。
3. 业务 Worker 在可信 Runtime 身份已经存在时，仍可能优先使用历史 Worker client
   secret，导致 Console `/oauth/token` 返回 `invalid_client`。
4. Console 通知代理验证了用户 bearer/session，却没有把验证结果写入
   `event.context.consoleAuth`，Tenant Runtime 因而无法生成可信用户委托签名。
5. Runtime 数据库中的 integration/vault 授权仍是未限定 audience 的旧资源名；
   新 token issuer 要求 `data-runtime:` 或 `tenant-runtime:` 前缀。
6. 八个业务应用统一读取 `feedback.reporter.enabled`，部分 Runtime 身份缺少
   `system_settings:view`。

## 修复范围

- Tenant Gateway 为 Console 和业务 API 路由统一注入 Runtime bootstrap 上下文。
- Foundation 的 OIDC/JWKS、session bridge、授权快照、目录、应用列表、通知、
  runtime settings 与 service token 客户端统一携带租户 Runtime 上下文。
- 可信 Runtime app identity 优先于历史 Worker client secret。
- Console 通知代理把已验证用户绑定到 `consoleAuth`，供 Runtime 用户委托签名使用。
- 增加 audience-qualified integration/vault grant 迁移。
- 增加业务 Runtime `system_settings:view` 最小只读授权迁移。

## 数据库迁移

已同时应用到：

- `/etc/hzy-data-runtime/.env` 指向的 Console 数据库。
- `/etc/hzy-data-runtime-ctr812/.env` 指向的迁移后 Console 数据库。

迁移文件：

- `console/docs/sql/Console-SQL-Seed-v1.58-runtime-integration-grants.sql`
- `console/docs/sql/Console-SQL-Verify-v1.58-runtime-integration-grants.sql`
- `console/docs/sql/Console-SQL-Seed-v1.84-runtime-feedback-setting-grants.sql`
- `console/docs/sql/Console-SQL-Verify-v1.84-runtime-feedback-setting-grants.sql`

两个数据库的验证结果均显示相关 active service client 拥有 active grant。

## 已发布 Worker

| Worker | Version ID |
| --- | --- |
| Tenant Gateway | `f97bbc3d-ad72-4b83-b09d-b59660fe62ff` |
| Console | `f430e64b-c66c-4cd6-8eba-0d806a14aaed` |
| Codocs | `16f010d7-3939-4bb7-95be-ffd033788e89` |
| Finance | `a9e3ce86-23dc-4e9e-8703-a4afde7a4cb8` |
| AIMS | `838911d2-e0c0-4152-ae87-2b4181bed6b8` |
| People | `be273a85-cf35-4391-b9b9-d72fe473e001` |
| Assets | `d720529b-745b-4ca5-9140-8743d104546d` |
| Workflow | `c5674eb5-3823-42cc-a892-5bc44044226a` |
| Altoc | `4765a322-3f3d-4896-8a09-2dad577bc23d` |
| WebDev | `01e29b3f-81a6-4e3c-9d84-041c4885fbf4` |

## 验证

- Foundation 全量测试：221/221。
- Console 全量测试：369/369。
- Tenant Gateway 路由测试：7/7。
- Foundation 与 Console typecheck、lint：通过。
- 所有上述业务应用 Cloudflare production build：通过。
- `git diff --check`：通过。
- 真实浏览器：Codocs、Finance、AIMS、Workflow、Altoc、WebDev 页面主体可用；
  People 正确显示角色受限页。
- Cloudflare tail：最新 Codocs 通知、反馈设置、部门文档与目录请求均为 `Ok`；
  最新 Assets 核心请求全部为 `Ok`，补权后不再出现
  `insufficient_scope: system_settings:view`。

## 非阻断观察项

- 本机构建 Node.js 为 25.8.1，仓库声明 Node 22.x；本次构建和测试均通过，但后续
  CI/发布机应统一到仓库声明版本。
- Cloudflare 构建仍报告 sourcemap、chunk size 和部分未启用 scheduled task 警告；
  与本次 OIDC 503 无关。
- SSH 客户端提示服务器未启用 post-quantum key exchange；不影响本次迁移，但可列入
  后续基础设施加固。

## 后续修正

同日确认 People 的 no-access 并非正确角色结果，而是 People 自建权限代理未携带完整
Tenant Runtime 上下文造成的误判。该问题已由 People Worker
`14d63316-38eb-4a8e-9bc5-d17e8da49347` 修复并通过生产浏览器验证，详见
`memory/2026-07-18-people-permission-runtime-proxy.md`。
