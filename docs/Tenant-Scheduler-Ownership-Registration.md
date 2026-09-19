# 逐租户统一调度所有权登记

控制面原有 tenant_runtime_instances、tenant_runtime_instance_apps 及 deployments 只能证明技术登记和状态，不能证明任务迁移或单一写入者。此入口不从 manifest、套餐或全局环境变量启用统一队列。

## 合同与默认行为

- 独立迁移 `platform/docs/sql/migrations/20260913-tenant-scheduler-ownership.sql` 创建当前所有权与不可变命令回执，不插入任何启用数据。部署依赖此 SQL 先于新 resolve 代码；表不可访问是故障，不能回退为“没有登记”。
- 当前主键为 tenant + environment + aims，每个范围只有一个 runtime/worker/client/generation。generation 是规范 uint64 十进制字符串，数据库 DECIMAL(20,0)，JSON 不经 JS number。修订号用于乐观并发。
- 操作权限是现有 `ops.deployments:admin`（`platformOpsRbac.ts` 的部署配置管理动作），不是订阅管理员；actor 只取认证 middleware，不能由请求覆盖。
- `POST /api/platform/ops/deployments/scheduler-ownership` 默认 mode=plan，只返回规范计划/hash，不写表。mode=verify 只读登记，不签发凭据、不连接 Runtime、不声称自动验证迁移。
- mode=attest 是运营人员明确登记已核实报告的动作：核对 Runtime schema/path/task generation、旧队列停止消费与在途租约处置、真实 worker deployment/client、单一 owner 后，填写 verificationReference 和报告 SHA256。`verificationMethod=operator-attested` 明确为人工核验记录，reference/hash **不是自动签名校验的证明**。不另设多级审批。
- 登记统一模式同事务核对现有 ready Runtime 与唯一 active Aims deployment，再以 tenant 行锁、expectedRevision 更新登记并追加回执。相同 requestId/payload 重放保持；异 payload 拒绝；审计失败全部回滚。
- unified→disabled 保留同一 runtime/worker/generation，仅增加 revision，不要求故障中的 Runtime 恢复 ready。重新启用必须增加 generation，不能悄悄恢复旧 wake。

## resolve 消费

`platform/internal/tenant-gateway/resolve` 对每个匹配站点读取独立 ledger。没有记录才真正省略 `apps.aims.enterpriseScheduler`；有记录总是返回 `{storage:'unified'|'disabled',generation:'7'}`。持久值 disabled、runtime 不 ready、runtime/worker 漂移、出现多个 active Aims deployment 均返回 disabled，不能省略回 legacy。坏 generation 是记录损坏而非关闭代次，失败关闭。停用一个 scheduler 不使正常 resolve 整站失效。

正常启用值必须同时匹配请求站点的 tenant/environment、现 Runtime 与唯一 worker；人员权限和商业资格不受登记影响。Gateway/worker 还应核验签名选择和请求 generation；本入口不替代 Runtime 自己的 Registry generation 和服务授权检查。

## 可执行准备

```sh
node --experimental-strip-types platform/scripts/test-scheduler-ownership-mysql.mjs
pnpm --dir platform typecheck
```

真实 API 在已认证运营会话调用。verify 请求为 `{"mode":"verify","tenantCode":"C000001","environment":"test"}`；plan 请求在下列形状中填入**已核实**的实际值，默认不带 mode=attest：

```json
{
  "mode": "plan",
  "storage": "unified",
  "tenantCode": "C000001",
  "environment": "test",
  "runtimeCode": "c000001-test-tenant-runtime",
  "workerDeployment": "C000001-test-aims",
  "workerClient": "aims.runtime",
  "generation": "7",
  "expectedRevision": 0,
  "requestId": "unique-operation-reference",
  "verificationMethod": "operator-attested",
  "verificationReference": "replace-with-reviewed-migration-report-reference",
  "verificationSha256": "replace-with-actual-report-sha256"
}
```

上例 generation 7 是协议示例，不是 C000001 已登记代次；reference/hash 占位值不能通过有效登记。当前测试环境尚未应用 SQL 或提交 attest。后续执行者须先实际核实报告与登记计划，再显式发送相同计划 mode=attest；不得批量给全部租户默认开启。

隔离 MySQL 使用既有 temporary harness，覆盖 plan 无写入、绑定校验、CAS/幂等、漂移 disabled、停用与单调 generation、审计触发器失败回滚。没有写入真实业务数据库。
