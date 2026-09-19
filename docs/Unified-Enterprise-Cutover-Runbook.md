# ADR-018 切换与恢复 Runbook

本文是 INT-206 的执行手册，面向实际操作者。它不重复协议推导，只给出顺序、命令、判据和中止条件；合同与不变量见[源端写栅栏与最终复制协议](./Unified-Enterprise-Cutover-Protocol.md)，数据边界见[统一数据合同](./Unified-Enterprise-Data-Contract.md)。

本手册只描述**已授权环境**内的执行。生产或未授权租户的执行不在本文授权范围内；每个阶段都必须先确认当前租户、环境、Runtime 部署与 generation 与工单一致。

## 0. 前置条件（全部满足才开始）

| 检查 | 命令或来源 | 通过判据 |
| --- | --- | --- |
| 迁移计划最新且无阻塞冲突 | `go run ./cmd/hzy-enterprise-migrate --config <protected> --plan <plan>` | `conflicts=0`，记录 `review_hash` |
| 影子复制与源一致 | 见第 3 节对账 | 逐表行数零差异、业务键集合一致、孤儿引用为 0 |
| 目标未激活 | 计划输出 | `generation=0`，无路由或凭证变更 |
| 旧可靠任务可排空 | 调度所有权回执 | 单一 owner，在途 operation 可结清 |
| 回退准备就绪 | 第 6 节 | 恢复 owner、路由 CAS 与专用账号均已就位 |

任一项不满足即中止，不进入维护窗口。

## 1. 快照

1. 记录源端与目标的 `enterprise_schema_registry`（tenant / environment / runtime deployment / schema version / generation）。
2. 记录两侧逐表行数与业务键摘要，作为对账基线。
3. 记录当前 Worker 版本、Service Binding 与 cron trigger（方法见[部署与路由清单](./Unified-Enterprise-Deployment-and-Routing-Inventory.md)的观测窗口）。

快照只读，不改任何状态；快照与后续对账必须来自同一批次口径。

## 2. 写入暂停、drain 排空与单向追平

按协议阶段 A→B 执行：

1. **A. 安装并核验 guard**：保持 legacy 可写，安装源端写栅栏并核验。核验失败直接中止，不进入 B。
2. **B. 排空可靠任务后原子关闭源写**：先排空 integration drain 与通知类 operation，再在同一事务关闭源写。
   - 注意：当前测试环境**没有任何定时触发器执行 integration drain**（唯一 cron 只跑 policy sync，见 INT-001 回读）。排空必须由请求驱动路径或受保护控制端点显式触发，不能假设定时任务会自行清空。
   - 在途 operation 未结清时不得继续；重试同一 operation 身份，不得新建。
3. **单向追平**：源写关闭后执行完整重复制（协议阶段 C），不做双向同步。

## 3. 最终对账（进入激活的唯一门槛）

对账在源写已关闭、复制完成后执行，全部只读：

1. **逐表行数**：目标每张业务表的行数与计划中的源计数一致，允许差异为 0。
2. **业务键集合**：`product_code`、`biz_id`、`~line-` 空间标识在两侧集合完全一致。
3. **孤儿引用**：产品线空间 → 产品空间、模块来源 → 模块等关键关系的孤儿数为 0。
4. **同一权限主体查询结果**：至少一个受限主体与一个管理主体，在两侧以相同谓词取结果哈希，必须一致。只用管理员全量读取不构成通过。
5. **结构对象**：外键与触发器数量与计划一致。

任一项不一致：**不激活**，回到第 2 步重新追平或按第 6 节放弃本次窗口。对账方法与一次实跑结果见[影子对比回执](../deploy/test-env/artifacts/C000001.int-203-shadow-comparison.json)。

## 4. 写入 fencing 与激活

按协议阶段 D：在同一事务内激活目标并写持久回执，fence 与 registry owner/generation 一起提交。事务之外不得有网络调用。

激活后立即只读回验：`enterprise_schema_registry` 的 owner 与 generation、两个 fence 状态、激活 receipt 三者一致。任一不一致立即进入第 6 节。

## 5. 路由切换与恢复开放

1. 切换 Runtime endpoint 与 scheduler ownership（CAS 比较准备快照，不接受漂移）。
2. 只读回验实际生效的部署 endpoint 与 scheduler owner。
3. 确认 drain 的唯一 owner；若本环境仍无定时 owner，必须显式记录「零定时 owner」状态，不得声称调度所有权已切换。
4. 开放写入，先小流量业务链路验证再全量开放。

## 6. 回退路径

回退分两种情况，判据是**目标是否已经产生新写入**：

- **尚无新写入**：直接把路由与 scheduler owner 切回源端，目标保持 generation 不前进。源端 guard 解除后即恢复；不需要反向复制。
- **已有新写入**：**不得**简单切回旧库，否则丢失新事实。按协议第 7 节的 `enterprise-recovery.v1` 执行反向恢复：以 `hzy-enterprise-recover` 生成可审阅 activation hash，核验恢复 owner 签名与两个恢复 schema，再 `--apply --review-hash <hash> --publish` 激活并提交回执，随后重放同一回执做只读回验。

两种情况都必须：保留原激活 receipt、不重复拷贝新事实、失败时保持唯一 owner 并可用同一回执重试。

## 7. 中止条件（出现任一项立即停止并回退）

- 对账存在任何差异，或同一权限主体的结果哈希不一致。
- 在途 operation 无法结清，或出现重复消费迹象。
- 激活事务之外发现被修改的路由、凭证或 owner。
- 恢复 owner 签名、租户/环境/实例或专用账号任一项核验失败。
- 观测窗口内发现未登记的 cron、Service Binding 或 Worker 版本漂移。

## 8. 验证命令

```sh
# 迁移计划（默认 dry-run）
go run ./cmd/hzy-enterprise-migrate --config <protected> --plan <plan>

# 受控影子复制（需已复核 hash）
go run ./cmd/hzy-enterprise-migrate --config <protected> --plan <plan> --apply --review-hash <hash>

# 切换准备阶段（plan / install-fence / fence / prepare-final）
go run ./cmd/hzy-enterprise-test-cutover --config <protected> --source-plan <plan> --phase <phase> [--apply]

# 反向恢复
go run ./cmd/hzy-enterprise-recover --config <protected>
go run ./cmd/hzy-enterprise-recover --config <protected> --apply --review-hash <hash> --publish
```

隔离演练证据见[演练矩阵](../deploy/test-env/artifacts/C000001.int-207-isolated-rehearsal-matrix.json)。本手册描述流程与判据，不代表任何环境已经完成切换；实际执行属 INT-506。
