# Unified Proxy Worker

统一的 Cloudflare Worker 用于同时处理平台子域与自定义域的流量转发（生产环境生效）：

| 类型     | 示例                   | 解析方式                                            | 回源          | 标识头部                                                |
| -------- | ---------------------- | --------------------------------------------------- | ------------- | ------------------------------------------------------- |
| 平台子域 | tenant.repoinsight.com | 直接截取第一个 label 作为租户 ID                    | `ORIGIN_BASE` | `X-Tenant-Subdomain`, `X-Business-Name`                 |
| 自定义域 | shop.customer.com      | 查询 `domains` + `businesses` 表，状态需为 `active` | `ORIGIN_BASE` | `X-Custom-Domain=1`, `X-Business-Name`, `X-Business-Id` |

## 目标与收益
- 去除双层代理（原 root worker + domain-proxy）带来的 522 风险
- 自定义域与平台子域走一致的缓存 / 头部标记策略
- 上游应用可统一通过头部决定租户上下文

## 主要逻辑
位置：`workers/domain-proxy/worker.js`

步骤（生产环境）：
1. 解析原始 Host：仅判断是否“生产平台根域或其子域” (`PLATFORM_ROOT_DOMAIN`)
2. 非平台域 => 自定义域流程：
   - 内存缓存命中：直接使用
   - 未命中：查询数据库
     ```sql
     SELECT d.business_id, c.name AS business_name
     FROM domains d
     JOIN businesses c ON c.id = d.business_id
     WHERE d.hostname = ? AND d.status='active' AND c.status='active'
     LIMIT 1
     ```
   - 未找到：写入负缓存（短 TTL）并返回 404 错误页
3. 平台子域：提取首段作为租户；保留子域（api/auth/admin/storage）直接透传
4. 构造回源 URL：`ORIGIN_BASE + pathname + search`
5. 注入识别头部并发起 fetch
6. debug 模式：`?_debugDomain=1` 返回 JSON 元信息，不透传 body

## 环境变量
在 `workers/domain-proxy/wrangler.toml` 或 Cloudflare Dashboard 配置：

| 变量                        | 说明                                            | 示例                            | 必需 |
| --------------------------- | ----------------------------------------------- | ------------------------------- | ---- |
| `ORIGIN_BASE`               | 上游应用统一入口（Pages / 反向代理后的 origin） | `https://repoinsight.pages.dev` | 是   |
| `PLATFORM_ROOT_DOMAIN`      | 平台根域名                                      | `repoinsight.com`               | 是   |
| `DOMAIN_CACHE_TTL`          | 自定义域正向缓存秒数（上限 300）                | `60`                            | 否   |
| `DOMAIN_CACHE_NEGATIVE_TTL` | 自定义域未命中缓存秒数（上限 120）              | `15`                            | 否   |
| `TURSO_DB_URL`              | Turso 数据库 URL                                | `libsql://xxx.turso.io`         | 是   |
| `TURSO_DB_TOKEN`            | Turso 访问 Token                                | `xxxxx`                         | 是   |

Secrets (通过 `wrangler secret put` 设置，不存文件)：
- `TURSO_DB_URL`
- `TURSO_DB_TOKEN`
- 其它上游需要的敏感变量

## 头部约定
| 头部                 | 说明                                         |
| -------------------- | -------------------------------------------- |
| `X-Original-Host`    | 用户访问的原始域名                           |
| `X-Custom-Domain`    | 自定义域固定为 `1`                           |
| `X-Tenant-Subdomain` | 平台子域租户 ID                              |
| `X-Business-Name`    | 租户业务名称（数据库 business.name）或子域名 |
| `X-Business-Id`      | 自定义域解析出的公司 ID                      |
| `X-Proxy-Worker`     | 固定值 `unified`，用于日志区分               |
| `X-Proxy-Time`       | 上游响应耗时（毫秒）                         |

## 错误处理
使用 `createErrorResponse()` 输出美观 HTML：
- 404：域不存在或未激活
- 502 / 503：上游错误或内部异常

## 调试方法
```bash
# 平台子域调试
curl -H "Host: tenant.repoinsight.com" "https://<你的 worker 路由>/?_debugDomain=1"

# 自定义域调试
curl "https://customer.com/?_debugDomain=1"
```

输出示例：
```json
{
  "customDomain": true,
  "host": "blog.customer.com",
  "businessName": "Acme",
  "businessId": "cmp_123",
  "status": 200,
  "cacheHit": false
}
```

## 部署 & 路由
在 Cloudflare Dashboard 或 wrangler 路由配置（仅生产域）：
```
*.repoinsight.com/*            -> repoinsight-domain-proxy
*.your-custom-root.com/*    -> repoinsight-domain-proxy   (若有多根域)
<catch-all-custom-domains>  -> repoinsight-domain-proxy (通过自定义域接入)

开发模式说明：
- 本地/开发域名（如 lvh.me、localhost）不应绑定到该 Worker；本地开发直连 Nuxt/Pages 服务。
- Worker 代码不再对开发域名做特殊判断，仅以 `PLATFORM_ROOT_DOMAIN` 作为平台域识别依据。
- 如需调试 Worker，可使用 `wrangler dev` 或在生产子域上验证。
```
若 Pages 仍需要直接访问，可保留其原始域（不经 Worker）。

## 缓存策略
- 正向命中：TTL 默认 60s（可调）
- 未命中：负缓存 15s，避免频繁 DB 查询
- 激活新域名后可选择：
  - 等待自然失效
  - 后续可实现内部刷新端点（未实现）

## 常见问题
| 问题           | 处理                                                              |
| -------------- | ----------------------------------------------------------------- |
| 522 或 525     | 确认只保留一个 Worker 路径，不要双层代理；检查 ORIGIN_BASE 可直连 |
| 自定义域激活慢 | 检查 Cloudflare Custom Hostname SSL 状态；内部定时任务是否运行    |
| 404 错误页     | 确认 `domains.status=active` 且关联 `businesses.status=active`    |
| Header 丢失    | 确认未经过额外 CDN/代理剥离自定义头                               |

## 后续改进建议
- 内部刷新缓存 API（按域名强制失效）
- 可选 KV / D1 缓存层（跨 isolate）
- 统计头部命中率用于观测（加计数器或 R2 日志处理）

---
最后修改：自动化生成说明（请根据需要更新）。
