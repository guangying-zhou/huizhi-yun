# Codocs 首页 OSS 图片 500 调试报告

日期：2026-07-18

## 现象

Codocs 首页四张推荐文章封面请求
`GET /codocs/api/oss/image?path=codocs/info/images/...` 返回 500，页面图片无法显示。

## 根因链

1. Data Runtime 收到标准服务 JWT 后，将 `sub=client:codocs.runtime` 原样传给
   Console integration adapter；adapter 却用该值直接匹配数据库里的
   `service_clients.client_code=codocs.runtime`，导致精确授权记录存在但查询不到，
   返回 `console_service_integration_not_granted`。
2. 授权修复后，Vault 记录显示 OSS Secret 仍为
   `env_ref=ALIYUN_OSS_ACCESS_KEY_SECRET`，但迁移后的客户侧 Data Runtime 没有该变量，
   返回 `console_vault_env_unavailable`。
3. 服务器历史 Codocs 配置中找到的另一组 OSS 凭据已失效。实测其 AccessKey ID
   返回 `InvalidAccessKeyId`；原 `oss.default` AccessKey ID 仍存在，但配套 Secret
   不在文件、进程环境、Cloudflare Worker Secret 或旧数据库中。阿里云不会回显既有
   AccessKey Secret，因此需要登录阿里云轮换/创建新凭据。
4. Codocs OSS helper 还会把首次加载的 integration config 永久保存在
   `globalThis`。即使数据库轮换 AccessKey ID，存量 Worker isolate 仍使用旧快照。
5. Cloudflare 使用的 `aliyun-oss-s3` provider 曾把普通 OSS Endpoint
   `oss-<region>.aliyuncs.com` 直接用于 AWS V4 请求。阿里云 S3 兼容 API 要求
   `s3.oss-<region>.aliyuncs.com`，签名 Region 则使用通用 Region ID
   （例如 `cn-qingdao`），否则会返回 `SignatureDoesNotMatch`。
6. Console 集成编辑页更新已有集成时把只允许创建阶段写入的
   `integrationCode`、`integrationType` 一并放入 PATCH，导致 Runtime 拒绝更新。

## 已实施修复

- Data Runtime Console integration adapter 统一把标准服务主体
  `client:<clientCode>` 归一化为 `<clientCode>` 后再匹配授权。
- 增加 canonical JWT subject 的 integration grant 与 GitLab operation 回归测试。
- Data Runtime 主实例发布构建：
  `0.3.132 (49add54afe0b-dirty-codocsfix)`；隔离实例也先完成健康验证。
- Codocs 图片代理把当前 H3 event 传入 OSS helper；请求级 OSS client 在创建前总是
  重新读取 `oss.default`，避免凭据轮换后继续使用永久缓存。
- Foundation 存储层对 `aliyun-oss-s3` 自动规范化 Endpoint 和 Region，普通对象请求
  与预签名 URL 统一使用 AWS V4/S3 兼容合同，并增加两项回归测试。
- Codocs Cloudflare 最新版本：
  `6ffde9d1-566b-40d7-a2d9-e7e56362d25c`。
- Console 集成编辑页 PATCH 已排除不可写身份字段，避免保存配置时产生
  `Integration field is not writable`；Console Cloudflare 最新版本：
  `9363727c-580f-46d6-afdc-c0d81eca3ef7`。
- 原 env-ref v1 已迁移为数据库加密版本并绑定到 v4，证明 Codocs → Data Runtime →
  Vault 的解析链路正常；但迁入的是服务器历史 `.env` 中的失效 Secret，不能作为
  最终生产凭据。
- 数据库保留原 AccessKey ID；Data Runtime 环境未写入明文 Secret，Runtime 健康状态
  为 `ok`。当前绑定的 v4 是数据库加密版本，但其材料已证实失效，待有效凭据替换。

## 验证

- `go test ./...`：通过。
- `go vet ./...`：通过。
- Data Runtime 主/隔离实例 `/runtime/health`：`status=ok`。
- Codocs `lint`、`typecheck`、全部 136 项测试：通过。
- Foundation Endpoint/Region 与预签名 URL 回归测试：2/2 通过，lint、typecheck
  通过。
- Console 全量 373 项测试、lint、typecheck：通过。
- Cloudflare 构建、dry-run 和生产部署：通过。
- 线上日志确认：
  - integration config 读取从 403 恢复为 200；
  - Vault resolve 在配置有效时从 409 恢复为 200；
  - Codocs 已能实时读取轮换后的 AccessKey ID。
  - Endpoint 已正确变为 S3 兼容主机，签名 scope 已正确变为
    `cn-qingdao/s3/aws4_request`；
  - 服务端返回的 `StringToSign` 与本地重算完全一致，排除 Endpoint、Region、
    canonical request 和签名算法差异，剩余差异仅为 Secret。
- 对服务器历史 `.env`、辅助进程配置与所有当前进程环境中的候选 Secret 均做了
  不回显材料的在线探测，没有一项能与当前 AccessKey ID 配对。
- 最终对象读取仍需一组有效的 OSS AccessKey ID/Secret 才能完成。

## 剩余动作

1. 登录阿里云 RAM/AccessKey 管理。
2. 为 Codocs OSS 创建或轮换一组对 `wiz-rs` 具备最小读写权限的凭据。
3. 将 AccessKey ID 写入 `hzy_console.integrations(oss.default).config_json`。
4. 将 AccessKey Secret 写入客户侧 Data Runtime Vault（优先 `db_encrypted`，不回写
   Cloudflare Worker）。
5. 重新加载 Codocs 首页并确认四个图片请求为 200、无 OSS 错误日志。
