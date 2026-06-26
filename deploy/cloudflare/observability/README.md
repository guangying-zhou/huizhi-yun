# 汇智云 Observability Worker

本 Worker 承接浏览器端 RUM 数据采集：

- `POST /api/rum`：接收业务应用通过 Foundation RUM client 上报的页面、接口、Web Vital 和 JS 错误事件。
- Analytics Engine `HUIZHI_YUN_ANALYTICS_ENGINE` / dataset `analytics_events`：写入明细事件，保留可查询维度。
- D1 `RUM_DB`：保存租户级采样配置和 5 分钟粒度摘要，供 Platform dashboard 直接读取。

## 数据边界

明细事件只进入 Analytics Engine，不写入 D1。D1 只保存：

- `rum_settings`：租户 + 应用的开关、采样率、错误采样率、慢请求阈值。
- `rum_summary_buckets`：5 分钟摘要桶，用于 dashboard 快速展示。
- `rum_ingest_counters`：每日接收/丢弃计数，用于检查采样和配置是否生效。

前端 RUM client 会去掉 URL query/hash，不上报 Cookie、Authorization、请求体或用户输入内容。

## 部署

先在 Cloudflare Dashboard 启用 Workers Analytics Engine：

```text
Workers & Pages -> Analytics Engine -> Enable
```

如果未启用，`wrangler deploy` 会返回 `code: 10089`，Worker 无法绑定 Analytics Engine dataset。

Worker 通过 `wrangler.jsonc` 声明 dataset：

```jsonc
{
  "analytics_engine_datasets": [
    {
      "binding": "HUIZHI_YUN_ANALYTICS_ENGINE",
      "dataset": "analytics_events"
    }
  ]
}
```

首次创建 D1：

```bash
pnpm dlx wrangler@4 d1 create hzy-observability
```

把输出中的 `database_id` 写入 `wrangler.jsonc` 的 `d1_databases[0].database_id` 后应用迁移：

```bash
pnpm dlx wrangler@4 d1 migrations apply hzy-observability \
  --config deploy/cloudflare/observability/wrangler.jsonc \
  --remote
```

部署 Worker：

```bash
pnpm dlx wrangler@4 deploy --config deploy/cloudflare/observability/wrangler.jsonc
```

建议设置内部管理 token，供 Platform 后端读取配置和摘要：

```bash
pnpm dlx wrangler@4 secret put HZY_OBSERVABILITY_ADMIN_TOKEN \
  --config deploy/cloudflare/observability/wrangler.jsonc
```

租户网关通过 `HZY_OBSERVABILITY_ORIGIN` 转发 `/api/rum`：

```jsonc
{
  "vars": {
    "HZY_OBSERVABILITY_ORIGIN": "https://hzy-observability.<account>.workers.dev"
  }
}
```

Platform 通过下列变量读取设置与摘要：

```bash
HZY_OBSERVABILITY_API_URL=https://hzy-observability.<account>.workers.dev
HZY_OBSERVABILITY_ADMIN_TOKEN=<same-token>
```

## Analytics Engine 字段约定

`blobs` 顺序：

1. `tenantCode`
2. `appCode`
3. `eventType`
4. `route`
5. `metricName`
6. `method`
7. `statusGroup`
8. Cloudflare colo
9. Cloudflare country
10. browser family

`doubles` 顺序：

1. `value`
2. `duration`
3. `status`
4. `sampleRate`
5. client timestamp ms
6. `ok` as `1 | 0`
7. schema version

Analytics Engine 目前要求 `indexes` 只有一个值，本实现固定使用 `tenantCode` 作为采样键。

## API

### `POST /api/rum`

接收单条事件或 `{ events: [...] }` 批量事件，最多 25 条。

### `GET /api/observability/settings?tenantCode=C000001`

返回租户各应用 RUM 配置。设置 `HZY_OBSERVABILITY_ADMIN_TOKEN` 后需要 Bearer token 或 `x-hzy-observability-token`。

### `PUT /api/observability/settings`

请求体：

```json
{
  "tenantCode": "C000001",
  "appCode": "codocs",
  "enabled": true,
  "sampleRate": 0.05,
  "errorSampleRate": 1,
  "slowThresholdMs": 2500
}
```

### `GET /api/observability/summary?tenantCode=C000001&hours=24`

返回 D1 摘要桶和应用维度汇总。
