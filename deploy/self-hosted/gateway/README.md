# 自托管 Tenant Gateway（单站点，生产形态）

对应 [自托管拓扑方案](../../../docs/Go-Live-Self-Hosted-Topology-Plan.md) 的 G-1（生产级 Gateway）、G-2（常驻调度器）与 G-11（Tailscale 入口监听）。

两种入口形态，二选一：

```text
A. 回环（默认）：浏览器 → Cloudflare（DNS + Tunnel）→ cloudflared（本机）→ 本网关（127.0.0.1:ingress）
B. Tailscale（G-11，当前生产）：浏览器 → aidcp.wiztek.cn → 阿里云主机 nginx（TLS 终止）
       → Tailscale（WireGuard）→ 本网关（内网服务器 Tailscale 地址:ingress，仅放行 nginx 对端）

本网关
  ├─ Console / Enterprise Host / Workflow / Aims（调度）/ Codocs 编辑器 / Collab（全部 127.0.0.1）
  └─ Platform（配置的 HTTPS 源，仅注册表与 Runtime bootstrap）
```

## 设计

- **不复制路由逻辑。** 网关直接运行 `deploy/cloudflare/tenant-gateway/src/index.js`（Worker 源码，纯 Web API）。Node 宿主只负责：从配置构造 Worker `env`、提供 Service Binding 对象、Node HTTP ↔ Web Request/Response 转换、WebSocket 转接、常驻调度和本地健康检查。
- **一个网关只服务一个站点。** 公网主机名、租户、环境、各应用部署编码、Runtime 规范地址与 Platform 源全部来自配置文件；代码里没有 `wiztek.huizhi.yun`、`C000001`、现有部署编码或托管云地址。该租户的托管云站点（现有 `wiztek.huizhi.yun` 与 Workers）可与本站点并行运行，互不影响。
- **绑定来自配置 + Platform 注册表，从不来自请求头。** 每次请求、策略同步和调度唤醒都会先按主机名向 Platform 解析站点，然后用 `HZY_TENANT_GATEWAY_EXPECTED_BINDINGS_JSON` 与配置逐项比对（租户、环境、每个应用的部署编码、Runtime 地址与编码）；任何不一致一律失败关闭（请求 503，调度记为失败），不会落到托管云部署上。
- **Enterprise Host 试点放行泛化。** `validateEnterprisePilotBinding` 原有 C000001/test 固定试点行为不变；另外只接受配置显式列出的 `{host, tenantCode, environment, deploymentCode}`（由本配置自动生成，只含本站点）。不按环境名做特殊判断，其余一律拒绝。
- **出站白名单。** Worker 发出的所有请求（Service Binding 和普通 `fetch`）都经过同一出口：只允许配置里的回环应用源和 HTTPS Platform 源；未配置的应用路由到 `https://disabled.invalid` 并在本地返回 404；重定向只在 Worker 显式 `manual` 时透传，否则拒绝跟随。没有 `HZY_PLATFORM_SERVICE`，Platform 走普通 HTTPS。
- **可信头只由 Worker 生成。** 入口先删除客户端发来的**所有** `x-hzy-*`、逐跳头与 `forwarded` / `x-forwarded-host|proto|port|prefix`，再交给 Worker 的 `buildForwardHeaders` 按注册表结果重新生成 `x-hzy-gateway`、`x-hzy-gateway-token`、tenant/deployment/Runtime 等；宿主本身不再补任何 `x-hzy-*`。上游响应里的 `x-hzy-*` 诊断头（除 `x-hzy-gateway` 外）不会返回浏览器。
- **WebSocket。** Worker 用 `WebSocketPair`；Node 下的等价做法是：只接受 Worker 会路由到 Collab 的路径（`/codocs/ws`、`/collab/*`），校验 `Host` 与 `Origin: https://<publicHost>`，拨通回环 Collab 且收到 101 后再做原始 socket 拼接；上游只拿到握手头和网关生成的 tenant/environment/forwarded 头，**不带** Cookie、Authorization、网关 Token（Collab 用首帧一次性票据认证）。有并发上限、握手超时和空闲超时。没有 `Upgrade` 头的普通 HTTP 请求访问 `/codocs/ws` 时，网关在拨号前直接返回 `426 Upgrade Required`（与云端 Worker/Durable Object 一致，也避免暴露独立 Collab 的 HTTP 根页面）。`apps.collab.origin` 只填回环 origin（生产为 `http://127.0.0.1:31007`，与 `hzy-collab.service` / `env/collab.env.example` 的监听一致）；Collab 已在 Platform 登记为部署 `<tenant>-collab`（G-9），`apps.collab.deploymentCode` 应填该编码，启动校验要求恰好等于 `<site.tenantCode>-collab`，之后注册表答案与它逐项比对、不一致失败关闭。未填则不钉扎（仅兼容登记之前的配置）。
- **Codocs 编辑器外壳。** Enterprise 试点会把 `/codocs/*` 页面交给 Enterprise Host，但 iframe 编辑器（`/codocs/embed/editor/<id>`、`/codocs/_nuxt|fonts|pdfjs/*` 等）仍由 Codocs 进程提供：仅 GET/HEAD，只转发 `accept`，不带任何凭据；`_nuxt` 哈希资源可长缓存，其余 `no-store`。

## 与 hzy0 测试栈的取舍

| hzy0 组件 | 生产是否需要 | 原因 |
| --- | --- | --- |
| `console-facade` / `console-egress` | 不需要 | hzy0 的 Console 在本地、签发者在云端，需要门面和私有出口。自托管站点的 Console 就是本站点的签发者，网关直接按 Worker 路由转发；Console 自己持有生产凭据访问 Platform。 |
| `policy-sync` 私有投递（`/__hzy0/platform-policy`） | 不需要 | 生产 Console 直接从配置的 Platform 取签名策略；网关只负责按分钟发送带签名的同步唤醒（Worker 的 `runScheduledPolicyBundleSync`）。 |
| `runtime-transport` 回环拨号头 `x-hzy-local-runtime-dial-url` | 暂不发送 | Foundation 当前只接受 hzy0 的固定值，生产发送会让所有 Runtime 调用 503。Runtime 规范地址到回环地址的映射应在应用侧服务端配置（见下文“依赖”）。 |
| `/__hzy0/collab-token` | 不需要 | 生产 Collab 用自己的客户端凭据向本站 Console 换取服务 Token。 |
| `sso-facade-callbacks` | 不属于网关 | 新子域的 OIDC 回调需在身份源登记（运维动作，G-6/G-7）。 |
| 根路径 `/api/workflow-proxy/*`、`/api/notifications*` 等转给 Enterprise | 不复制 | 生产按 Worker 路由：根 `/api/*` 属于 Console。若 Enterprise Host 需要这些接口，应登记到 `/enterprise/api/...`（`resolveEnterprisePilotPath`）。 |

## 配置文件

默认路径 `/etc/hzy-gateway/gateway.json`（`--config` 或 `HZY_GATEWAY_CONFIG` 指定，必须是绝对路径）。启动前强制检查，任一不满足即以退出码 78 拒绝启动，错误信息不含任何配置值：

- 普通文件、不是符号链接（`O_NOFOLLOW` 打开）、无硬链接；
- 权限仅属主（`chmod 600` 或 `400`），属主为运行网关的用户；
- 所在目录不可被组/其他用户写入；
- 不超过 64 KiB，合法 JSON，无未知字段，无 `REPLACE_*` 等占位符。

示例见 [`gateway.config.example.json`](./gateway.config.example.json)（全部为占位符，原样使用会被拒绝）。

| 字段 | 说明 |
| --- | --- |
| `site.publicHost` | 本站点公网主机名（新子域）。入口只接受这个 `Host`。 |
| `site.tenantCode` / `site.environment` | Platform 中本站点的租户与环境编码；可使用新的环境编码，无特殊取值。 |
| `site.tenantDomainSuffix` | Worker 保留子域判断用，默认 `huizhi.yun`。 |
| `platform.origin` | Platform 源，必须 HTTPS（如 `https://hzy.wiztek.cn`）。 |
| `platform.registryResolvePath` | 注册表解析路径，默认 `/api/platform/internal/tenant-gateway/resolve`；bootstrap 路径由 Worker 按 `/resolve → /runtime-bootstrap-token` 推导。 |
| `runtime.endpoint` / `runtime.runtimeCode` | Platform 登记的 Runtime **规范** HTTPS 地址与编码，必须与注册表一致；不能填回环地址。 |
| `apps.<code>.origin` | 本机进程地址，只能是 `http(s)://127.x.x.x:端口` 或 `[::1]`，不带路径。支持 `console`（必填）、`enterprise`、`workflow`、`aims`、`assets`、`altoc`、`codocs`、`finance`、`people`、`collab`。 |
| `apps.<code>.deploymentCode` | 本站点该应用在 Platform 的部署编码；与注册表不一致即失败关闭。`collab` 必须等于 `<site.tenantCode>-collab`，登记之前的配置可省略。 |
| `enterprise.pilot` / `authPilot` | 打开 Enterprise Host 路由；需要 `apps.enterprise`。 |
| `listeners.ingress` / `listeners.health` | 默认只能绑定 `127.0.0.1` 或 `::1`，端口 1024–65535 且不同。`health` 永远只能回环。 |
| `listeners.ingress.host`（Tailscale 模式） | 也可以是**一个**明确的 Tailscale IPv4（`100.64.0.0/10`，如 `100.64.72.59`）。拒绝 `0.0.0.0`、`::`、IPv4 映射写法、内网/公网地址、主机名、网段、`100.100.100.100` 以及段首/段尾地址。 |
| `listeners.ingress.allowedPeers` | 仅 Tailscale 模式可用且必填：1–16 个明确的 Tailscale IPv4（如 nginx 主机 `100.98.120.65`），不得重复、不得等于监听地址；回环模式下出现即拒绝启动。 |
| `limits.*` | 请求体上限（默认 100 MiB）、请求头上限（16 KiB）、请求超时、WebSocket 并发与空闲超时、Platform 调用超时。 |
| `scheduler.drain` | `apps` 必须是本站点已配置的本地应用，且属于 `aims/altoc/assets/console/finance/people/workflow`。 |
| `scheduler.policySync` | 默认每 1 分钟（与 Worker `* * * * *` 相同），可设 1–15 分钟。 |
| `scheduler.alertAfterConsecutiveFailures` | 连续失败达到该值后记 `gateway-scheduler-alert`，`/readyz` 返回 503。 |
| `secrets.gatewayInternalToken` | 网关信任 Token，与本机各应用的 `HZY_TENANT_GATEWAY_INTERNAL_TOKEN`（或 `HZY_CLOUDFLARE_INTERNAL_TOKEN`）相同；≥32 字符。 |
| `secrets.platformRegistryToken` | Platform 注册表 / bootstrap 的 Bearer；必须与上一项不同。网关从不设置 `HZY_CLOUDFLARE_INTERNAL_TOKEN`，避免把网关 Token 发给 Platform。 |

## 启动

```bash
# 以网关用户放置配置
install -d -m 700 -o hzy-gateway -g hzy-gateway /etc/hzy-gateway
install -m 600 -o hzy-gateway -g hzy-gateway gateway.json /etc/hzy-gateway/gateway.json

# systemd（推荐）
cp deploy/self-hosted/gateway/hzy-tenant-gateway.service /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now hzy-tenant-gateway

# 或 PM2（单实例 fork，调度器不得双跑）
pm2 start deploy/self-hosted/gateway/pm2.config.example.cjs
```

运行目录需要包含 `deploy/` 与 `foundation/shared/`（Worker 源码会导入）。要求 Node ≥ 22。

cloudflared ingress 指向入口端口，保留原始 Host（不要把 `httpHostHeader` 设成其他值）：

```yaml
ingress:
  - hostname: <site.publicHost>
    service: http://127.0.0.1:<listeners.ingress.port>
  - service: http_status:404
```

## Tailscale 入口模式（G-11：nginx → Tailscale → 网关）

配置片段（其余字段不变）：

```json
"listeners": {
  "ingress": { "host": "100.64.72.59", "port": 8780, "allowedPeers": ["100.98.120.65"] },
  "health": { "host": "127.0.0.1", "port": 8781 }
}
```

行为：

- **连接级白名单。** 入口服务器在 HTTP 解析器挂上之前（`prependListener('connection')`）检查 `socket.remoteAddress`（`::ffff:a.b.c.d` 归一为 IPv4），不在 `allowedPeers` 中的连接立即 `destroy()`：不返回任何字节，不产生请求，也不会进入 WebSocket 升级。请求与升级处理器里还会再检查一次（纵深防御）。
- **拒绝计数。** `/healthz` 的 `ingress` 字段给出 `{ mode, allowedPeerCount, peerRefusals }`；日志 `gateway-ingress-peer-refused` 每分钟最多一条，只含累计数和本周期数，**不记录任何地址**。
- **Host 校验不变。** 仍只接受 `site.publicHost`（配置项，例如 `aidcp.wiztek.cn`；代码不写死），其他 Host 返回 421。
- **不信任任何转发头做身份。** 客户端与 nginx 发来的 `x-hzy-*`、`forwarded`、`x-forwarded-host|proto|port|prefix` 照旧全部删除，并在本模式下额外删除 `x-forwarded-for`、`cf-connecting-ip`、`true-client-ip`、`x-client-ip` 等客户端地址声明。
- **审计地址（仅审计）。** Console 登录/OIDC 审计读取 `x-forwarded-for`。本模式下网关只在连接来自白名单对端时读取 nginx 的 `X-Real-IP`（由 `$remote_addr` 设置），合法且非回环/非未指定地址才采用；否则一律使用对端地址（nginx 的 Tailscale IP）。网关据此重写 `x-forwarded-for` 与 `x-real-ip`，**网关自身不依据它做任何决定**。这样应用看到的值不会是客户端伪造值，也永远不会是回环地址（Console 有依据回环地址放宽的本地诊断判断，见“已知风险”）。WebSocket 上游不带该头。
- **启动顺序。** 开机时 tailscaled 可能尚未分配地址，绑定会报 `EADDRNOTAVAIL`：网关对该错误按 0.5 s 起指数退避（上限 10 s）重试最多约 120 s，期间健康端口已监听、`/readyz` 返回 503；仍失败则以退出码 1 结束，由 systemd `Restart=on-failure` 重启。其他绑定错误（如 `EADDRINUSE`）立即失败。回环模式不重试。
- **不支持**：`0.0.0.0`/`::` 监听、多地址监听、主机名或网段白名单、nginx 以外的对端直接访问。

### 阿里云主机 nginx（示例）

```nginx
map $http_upgrade $connection_upgrade {
  default upgrade;
  ''      '';
}

upstream hzy_self_hosted_gateway {
  server 100.64.72.59:8780;   # 内网服务器 Tailscale 地址:listeners.ingress.port
  keepalive 32;
}

server {
  listen 443 ssl http2;
  server_name aidcp.wiztek.cn;
  ssl_certificate     /etc/nginx/ssl/aidcp.wiztek.cn.fullchain.pem;
  ssl_certificate_key /etc/nginx/ssl/aidcp.wiztek.cn.key;

  client_max_body_size 100m;          # 与 limits.maxRequestBodyBytes 对齐

  # 协作 WebSocket（浏览器 → nginx → 网关 → 回环独立 Collab）。显式的精确匹配：
  # Upgrade/Connection 头、关闭缓冲、600 秒读写超时（须 ≥ limits.webSocketIdleTimeoutMs=300000，
  # 默认 60 秒会让无消息的空闲编辑连接被 nginx 切断）。Origin 与 Sec-WebSocket-* 由 nginx 原样透传，
  # 网关只接受 Origin=https://<publicHost>；无 Upgrade 的普通请求由网关直接返回 426。
  location = /codocs/ws {
    proxy_pass http://hzy_self_hosted_gateway;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For "";
    proxy_set_header X-Forwarded-Host "";
    proxy_set_header X-Forwarded-Proto "";
    proxy_set_header Forwarded "";
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
  }

  location / {
    proxy_pass http://hzy_self_hosted_gateway;
    proxy_http_version 1.1;
    proxy_set_header Host $host;                  # 必须是公网主机名，网关只认 site.publicHost
    proxy_set_header Upgrade $http_upgrade;       # Collab WebSocket
    proxy_set_header Connection $connection_upgrade;
    proxy_set_header X-Real-IP $remote_addr;      # 仅作审计，网关会校验并重写
    # 不向网关传递任何转发声明；即使传了，网关也会删除，不作信任依据。
    proxy_set_header X-Forwarded-For "";
    proxy_set_header X-Forwarded-Host "";
    proxy_set_header X-Forwarded-Proto "";
    proxy_set_header Forwarded "";
    proxy_request_buffering off;
    proxy_buffering off;
    proxy_read_timeout 600s;                       # ≥ limits.webSocketIdleTimeoutMs
    proxy_send_timeout 600s;
  }
}

server {
  listen 80;
  server_name aidcp.wiztek.cn;
  return 301 https://$host$request_uri;
}
```

要点：修改 nginx 前备份现有站点配置，`nginx -t` 通过后再 reload，不动其他站点；`Host` 必须原样传 `aidcp.wiztek.cn`（`$host` 已去掉端口）；Origin 由浏览器原样带过去，网关只接受 `https://<publicHost>` 的 WebSocket。nginx 是共用主机，写入与重载需逐项批准。

### 内网服务器防火墙（firewalld）

网关白名单是应用层的最后一道；网络层还应只允许 nginx 主机经 `tailscale0` 访问入口端口：

```bash
firewall-cmd --permanent --new-zone=hzy-tailnet
firewall-cmd --permanent --zone=hzy-tailnet --add-interface=tailscale0
firewall-cmd --permanent --zone=hzy-tailnet --set-target=DROP
firewall-cmd --permanent --zone=hzy-tailnet --add-rich-rule='rule family="ipv4" source address="100.98.120.65/32" port port="8780" protocol="tcp" accept'
firewall-cmd --reload
firewall-cmd --zone=hzy-tailnet --list-all
```

- 健康端口与各应用端口只监听回环，不需要也不应开放。
- tailscaled 默认会在 `ts-input` 链中自行放行 `tailscale0` 流量，可能先于 firewalld 规则生效；因此**必须实测**：从另一台 tailnet 节点访问 `100.64.72.59:8780` 应被丢弃（或至少被网关断开且 `peerRefusals` 增加），从 nginx 主机访问应成功。同时建议在 Tailscale ACL（tailnet policy）中只允许 nginx 主机访问该端口。
- 如需 systemd 层兜底，可在单元覆盖中加 `IPAddressDeny=any` + `IPAddressAllow=localhost 100.98.120.65 <Platform 出口地址>`；注意这会同时限制出站（Platform HTTPS），需先确认 Platform 地址。

### systemd

示例单元已加 `After=network-online.target tailscaled.service`（未安装 tailscaled 时无影响）。`After=` 只保证 tailscaled 进程先启动，不保证地址已分配，所以网关自带上面的 `EADDRNOTAVAIL` 退避重试，最终失败由 `Restart=on-failure`（`RestartSec=5`）兜底。不要用 `net.ipv4.ip_nonlocal_bind=1` 绕过：它会让绑定在地址不存在时也“成功”，掩盖 Tailscale 故障。

## 健康检查

健康端口只在回环地址监听，且只接受 `Host` 为 `127.0.0.1` / `localhost` / `[::1]` 的请求（防 DNS 重绑定），公网入口不提供该接口。

- `GET /healthz`：进程存活即 200，返回站点标识、启动时间、WebSocket 数、入口模式与对端拒绝计数（`ingress`，不含地址）和调度计数（不含任何 Token）。
- `GET /readyz`：入口未监听或任一调度任务连续失败达到阈值时返回 503，适合接外部告警。

```bash
curl -s http://127.0.0.1:<health.port>/readyz
```

## 调度行为

| 任务 | 周期 | 对应 Cloudflare cron | 行为 |
| --- | --- | --- | --- |
| `integration-drain` | 每 5 分钟，UTC 整点对齐 | `*/5 * * * *` | 只唤醒 `scheduler.drain.apps` 中的本地应用；不读取 Platform 全局分片页，而是用本站点固定的一页；每次唤醒前仍按主机名解析注册表并比对绑定。请求头带 Worker 生成的 HMAC 签名（Foundation 60 秒时钟偏差校验）。 |
| `policy-sync` | 默认每 1 分钟，UTC 对齐 | `* * * * *` | 调用 Worker 的 `runScheduledPolicyBundleSync`，向本地 Console 发送签名的 `/api/internal/policy-bundle/sync`。 |

- 触发时刻为 UTC 纪元上的整分钟 / 整 5 分钟，无随机抖动；定时器晚到不会漂移，也不会对同一时刻触发两次。
- 同一任务不重叠：上一次未结束时，本次记为 `skippedOverlaps` 并跳过。
- 每次运行记录 runs / successes / failures / consecutiveFailures / 最近耗时与摘要（纯数字和枚举阶段）。失败日志只含错误类名，不含错误消息、URL 或 Token。
- 停止（SIGTERM）时不再排新任务，等待进行中的任务结束（最长 20 秒）。

## 日志

- 宿主日志为 JSON 行（`gateway-started`、`gateway-scheduler-run`、`gateway-scheduler-alert`、`gateway-request-failed` 等），不记录请求头、查询串或请求体。
- Worker 源码中的 `console.*` 输出经过脱敏：配置中的密钥、`Bearer`/`Basic` 凭据、JWT 形态字符串、OAuth 查询参数（`code`、`state`、`token` 等）以及 `x-hzy-gateway-token` 等头值一律替换为 `[redacted]`；Error 只输出类名与脱敏后的消息，不输出堆栈。

## 有意不支持

- 多租户 / 多站点：一个进程只服务一个 `site.publicHost`。
- Platform 静态注册表（`HZY_TENANT_GATEWAY_REGISTRY_JSON`）与 Cloudflare Service Binding（包括 `HZY_PLATFORM_SERVICE`）。
- 非 HTTPS 的 Platform 源、非回环的应用地址或健康监听地址、`0.0.0.0` / `::` 监听；入口除回环外只允许一个带对端白名单的 Tailscale 地址。
- 应用经公网入口携带 `x-hzy-gateway-token` 的“受信内部转发”（包括 Gateway service assertion 通道）：公网入口删除全部 `x-hzy-*`。本机应用应直接经回环访问 Console（等同 Service Binding）。
- 观测（`/rum` 等）与 Webdev 路由：返回 404。
- Cloudflare 边缘缓存（`caches.default`、`cf` 选项）：本地无效，缓存交给 Cloudflare 边缘按响应头处理。
- 除 Collab 路径外的 WebSocket（包括开发 HMR）。

## 依赖其他工作（本目录未改动）

- **应用侧 Runtime 回环映射（G-3，Foundation）**：`foundation/server/utils/localTestRuntimeTransport.ts` 只接受 hzy0 固定值。生产需要由应用服务端配置（而非请求头）声明“规范 Runtime 地址 → 本机回环地址”，并校验可信网关上下文与部署绑定。
- **应用访问 Console 的回环路径（G-3/G-4）**：Node 模式下无 `HZY_CONSOLE_SERVICE` 时 Foundation 会回落公网 URL；自托管需改为回环直连本站 Console。
- **Platform 记录（G-6）**：本站点需要独立的 `deployment_sites` / `deployments` / `tenant_runtime_instances` 记录。注册表按 `(tenant, environment)` 聚合部署，与托管云站点共用同一环境编码会使解析结果混杂，本网关会因绑定不一致而失败关闭——建议新站点使用独立环境编码。
- **授权核验（G-7）**：新部署编码与 audience 需要按根 CLAUDE.md 做 grant verify 与签发探测后才能宣称可用。

## 已知风险（本目录之外）

- **Console 本地诊断判断。** `console/server/api/activation/diagnostics.get.ts` 的 `isLocalRequest` 以 `Host` 为回环且（`x-forwarded-for` 首项或 socket 对端）为回环判定“本地”。经网关到达的请求，Console 看到的 Host 与 socket 对端都是回环；Tailscale 模式下网关总是写入非回环的 `x-forwarded-for`，因而不会被判为本地。回环（cloudflared）模式保持原有透传，客户端可在 `x-forwarded-for` 首项填 `127.0.0.1`，且无该头时也会被判为本地——该判断应改为不依赖可转发头（Console 侧修复，未在本目录处理）。
- **审计 IP 的可信度取决于 nginx。** `X-Real-IP` 只在白名单对端连接上采用；若 nginx 主机被攻破或配置错误，审计 IP 可被伪造，但不影响任何授权。

## 测试

```bash
pnpm validate:self-hosted-gateway          # 本目录测试（node:test，全部本地夹具）
pnpm validate:tenant-gateway               # Worker 既有测试
node --test deploy/test-env/enterprise-topology.test.mjs deploy/test-env/cloudflare-gateway.test.mjs \
  'deploy/test-env/local-enterprise/test/*.test.mjs' 'deploy/test-env/test/*.test.mjs'
```

测试只使用回环夹具服务、模拟的 Platform 源和每次随机生成的密钥，不访问网络、数据库或任何真实凭据。
