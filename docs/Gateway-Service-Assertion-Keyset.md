# Gateway 断言：签名 keyset 与员工登记（第二批）

本批是代码和隔离测试，未应用现有数据库、登记环境公钥、写 secret、部署或启用开关。
第一批迁移见 [迁移合同](Gateway-Service-Assertion-Registry-Migration.md)。
exchange 与 Gateway 签名属于后批；本批没有新增签发或业务授权路径。

## 员工登记与轮换

`POST /api/platform/ops/deployment-sites/{siteCode}/gateway-keys`：

- 只接受已验证的 `platform_admin` 员工会话与显式 `ops.deployments:deploy`。
  内部服务 token、Runtime control token、租户管理员不能代替该会话。
- 服务端按 BINARY 精确 code 锁定 active deployment site，再锁定 keyset；
  tenant/environment 只从真实 deployment site 取。已有 registry 的 code/tenant/environment
  必须与当前 deployment site 完全相等，变更绑定返回 409，不自动迁移公钥。
- 登记体 `{action:"register",expectedRevision,publicKey,notBefore,notAfter}`。
  publicKey 是原始 32-byte Ed25519 公钥的规范 base64url；kid 由服务器派生 SHA256。
  时间是 Unix 毫秒，notBefore 不早于执行时刻，notAfter > notBefore，跨度最多 90 天。
  实际登记应预留开始时间（例如未来一分钟），到期再激活；不接受私钥或 tenant/env 字段。
- 激活/撤销体 `{action:"activate"|"revoke",expectedRevision,kid}`。
  新 key 为 next，只有在有效期内才能 next→active；next/active 都能撤销。
  revoked 不得再登记/激活；登记过的 key 不续期或替换，轮换须使用新 keypair。
- 初次 expectedRevision=0，成功 revision=1；之后每次成功命令加一。
  陈旧 revision 409，不自动换版本重试。两个 next/active 槽满时 409，不自动撤销旧 key。
- deployment site、keyset、key 行、revision 与 `platform_audit_logs` 同一事务；
  审计失败全回滚。审计只含公开身份/状态/修订元数据，无私钥或请求凭据。
  本批不生成私钥；员工生成及写入测试 Gateway Worker secret 须按环境计划另审。

## 独立签名读取端点

`GET /api/v1/runtime/gateway-keyset?runtimeCode=…&gatewayDeployment=…`：

- 精确自鉴权入口，只接受该已登记 Runtime 的 `hzy_ctl_` 控制 token（数据库哈希常量时间比较）。
  从 Runtime 行取 tenant/environment，与 Gateway 当前真实 deployment site 和冻结登记绑定逐项相等。
  控制凭据只授权此读取，不获得业务路由权限。实例只允许 status=ready；
  enrolled（首次heartbeat前）/unhealthy/未知状态以503 gateway_keyset_runtime_not_ready拒绝。
  轮询的Runtime、site、registry与keys均为事务内普通一致读，不锁heartbeat/cutover行。
  员工修改命令仍保留FOR UPDATE。新登记Runtime首次ready heartbeat前使用旧路径。
- 用现有 Platform Ed25519 签名函数，签名原文为
  `hzy-gateway-keyset.v1 + "\n" + body`；不复用无签名 heartbeat 作为信任根。
- 外层 `{schema,alg:"Ed25519",kid,body,signature}`；**没有自报公钥**。
  body 是共享 `stableStringifyPolicyPayload` 规范 JSON：
  `{tenant,environment,runtimeCode,gatewayDeployment,revision,issuedAt,expiresAt,keys}`。
  keys 按 kid 排序，每项 `{kid,publicKey,status:"next"|"active",notBefore,notAfter}`。
- 有效期最长 **5 分钟**，cache-control:no-store。包含所有 next/active（即使 key 已过期），
  不随当前时间过滤 key，防止同 revision 的语义内容自行变化；消费者校验 key 时间与 active 状态。
  全部撤销后返回新 revision 的签名空数组。缺登记/绑定变化/不可用签名均失败关闭。
- 查询只传所需列，最多两条 live key；命令额外查被操作的历史 kid，最多三条。
  轮换历史不随每次 keyset 请求整体返回。

## Runtime 固定信任根、持久化与失败关闭

操作员安装的 `config.json` 可选配置（示意值，不含真实信任材料）：

```json
{
  "gatewayKeyset": {
    "enabled": false,
    "environment": "test",
    "gatewayDeployment": "test-gateway",
    "platformKeyId": "operator-pinned-key-id",
    "platformPublicKey": "<operator-pinned Ed25519 PUBLIC KEY PEM>"
  }
}
```

默认关闭，无拉取、无新文件写入。开启 keyset 同步**不等于开启 exchange**。
信任根独立于 `control.platformSigningKey*`；unsigned heartbeat 的
`platform-signing-key.json` overlay 永不覆盖这里的 pin。换根必须受控重新安装配置，
未知 signer kid/错根一律拒绝，不能从响应发现新根。

开启后每分钟独立拉取（HTTPS、控制凭据、15 秒超时、拒绝跳转、最多 64KB）。
验签后严格解析（拒绝未知字段、重复字段、尾随 JSON），复核四项绑定、签名域、
时间、90 天 key 窗、canonical 公钥/kid、最多两 key。只用 active 且自身未过期的 key。

每次成功接收时，在 `control.configDir/gateway-keyset.json` 原子写入（0600、
临时文件 fsync→rename→目录 fsync），成功落盘前不授权。签名 envelope 建立持久 revision 基线：
拒绝更低 revision、同 revision 不同语义 keyset、issuedAt 后退。
同 revision 只允许重新签名续期（keys/binding 必须相同），不允许借续期撤销/换 key。

**启动更保守**：落盘签名只恢复回滚基线，不直接恢复可用状态；每次进程启动
必须先成功拉取新鲜签名 keyset。这防止上次验签/落盘失败后重启恢复旧可用缓存。
坏签名、未知 kid、错绑定、回滚、非 200/跳转、超大/坏 JSON 立即阻断新路径，
同时尝试持久 blocked 标记；存储失败立即不可用并保留内存已观察到的 revision。
普通网络错误可继续使用先前验证 keyset，但只到其签名 expiresAt；无离线无限延长。
缓存期间撤销可见延迟最长 **5 分钟**（正常轮询约一分钟）。

已有 token/业务路径不读这个 store，关闭本功能时仍走原路。后批 exchange 将读取
该 store 并独立校验 grant/授权/防重放，不可把 keyset 或策略快照当作授权。
过期 replay 行有界清理在 exchange 批实现，本批不删除记录。

## 验证

- Platform 单元/全量测试：员工敏感动作、规范输入、90 天与槽位、不可复活、绑定冻结、
  revision 冲突、控制 token、租户/环境一致、签名域与空集合。
- `node scripts/test-gateway-keysets-mysql.mjs`：只启动 `/tmp` 一次性 MySQL，真实事务验证
  审计失败回滚、轮换、revision、并发同 revision 仅一条成功、绑定变化拒绝、端点签名。
- Runtime `go test ./internal/gatewaykeys ./internal/config -race`：签名与完整绑定、
  坏 JSON、key 时间、next 不授权、回滚/续期/撤销、0600/落盘失败、重启基线、HTTPS/跳转。
  TS 共享序列化生成的公开测试 fixture 经 TS/Go 验同一字节与签名（没有测试私钥入库）。
- 配置回归明确证明无签名 heartbeat overlay 不替换固定 root，且默认不开启。

## exchange 回退约束（第三批待实现）

Runtime无可用keyset时，以专用503 `gateway_keyset_unavailable` 拒绝。
Gateway只对该状态码+错误码组合回退旧三次调用路径；签名、replay、授权失败不回退。
旧路径回退不会在Console自动生成第二枚断言或第二枚令牌；第三批补合同测试。


## 站点身份（E1 修订）

Platform表以 site_id FK deployment_sites.id，冻结 gateway_site_code/tenant/environment。
既有线上 gatewayDeployment、gateway_deployment、gateway-deployment 头与 Runtime 配置
保留字段名，值均为 site_code。C000001/test 的活动站点是 wiztek-test，
public_url=https://hzy-test.huizhi.yun；不是任何 console/enterprise 应用部署。
不创建 app/订阅/deployment，不改变目录、权益或策略包。

员工使用 GET /api/platform/ops/deployment-sites/wiztek-test/gateway-identity?publicHost=hzy-test.huizhi.yun
导出 Worker identity；要求 platform_admin + ops.deployments:view，复核 active/frozen 绑定，
public_url 须 HTTPS、无账号/密码/非默认端口，输入 host 与 URL hostname 严格一致，否则403。
输出 deploymentCode=wiztek-test、tenantCode=C000001、environment=test、publicHost；无私钥。
导出后仍须核对 Worker 实际路由 host，不能据输入 host 修改站点或 registry。
