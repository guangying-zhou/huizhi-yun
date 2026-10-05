# 生产快照桶实测方案：版本 ID 与写一次条件能否同时成立

日期：2026-09-29。状态：**方案与脚本已就绪，未对任何真实 bucket 执行；执行需用户逐项批准。**
依据：[写入协调合同](./Codocs-Document-Write-Coordination.md)“剩余风险”——Runtime 上传要求取得非空、非 `null` 的 provider 版本 ID，并以 `x-oss-forbid-overwrite: true` 写一次；测试 bucket 开启了版本控制，而 OSS 在版本控制 bucket 上忽略该头。生产计划使用“从未开启版本控制的专用快照桶”，但**这个桶在返回版本 ID 的同时能否执行写一次，没有被实测证明**。这是共享个人文档协作（以及后续部门协作）上线的硬前置。

## 1. 为什么需要实测

Runtime 的上传/发布（`codocs_collaboration_snapshots.go` 与 `document_snapshot.go`）同时依赖两件事：

1. **写一次**：同一 key 第二次带 `x-oss-forbid-overwrite: true` 的 PUT 必须被 provider 拒绝（HTTP 409 `FileAlreadyExists`）。仅靠先 HEAD 再 PUT 挡不住并发。
2. **精确版本**：每次成功 PUT 返回可用的 `x-oss-version-id`，之后 `GET ?versionId=` 读回相同字节并回带同一版本头；空值和字面 `"null"` 视为不可用。

已知两种桶状态互相冲突：版本控制已开启的桶能给出版本 ID 但忽略写一次；从未开启版本控制的桶能执行写一次，但通常不返回版本 ID。若两者确实不能同时成立，则不能在现合同下发布，需要另行变更精确引用合同（见 §5），不得放宽校验来“让它过”。

## 2. 脚本与安全边界

`deploy/self-hosted/snapshot-bucket-proof.mjs`（V1 签名，Node 内置 crypto，无新增依赖；签名实现有阿里云文档已知答案测试）。

| 模式 | 行为 | 写入 |
| --- | --- | --- |
| 默认 | 只读：`GET ?versioning`、`GET ?lifecycle`、对测试前缀 `LIST`（≤20 项） | 无 |
| `--plan --run-id <id>` | 打印请求计划与 `planHash`，**不发任何网络请求** | 无 |
| `--write-proof --run-id <id> --confirm <planHash>` | 仅在 `_write-once-proof/<runId>/` 下创建少量 64 字节随机对象（`a.bin`、`b.bin`）；要求先审阅同一 `run-id` 的计划哈希 | 仅测试前缀 |
| `--overwrite-control`（配合 `--write-proof`） | 额外对 `c.bin` 做两次不带保护头的 PUT，证明该桶“允许覆盖”，使“写一次成立”的结论有对照意义 | 仅测试前缀 |
| `--cleanup`（配合 `--write-proof`） | 删除且仅删除本次运行创建的对象/版本，并确认最新读取为 404 | 仅本次对象 |

约束：

- 配置文件必须是本人所有、权限 `0600`；含 `bucket`、`endpoint`（仅主机名）、`accessKeyId`、`accessKeySecret`，可选 `testPrefix`。密钥不进 argv、日志或输出，错误信息里的长串会被脱敏。
- 测试前缀必须以 `_write-once-proof/` 开头，不得进入 `codocs/`、`recycle.bin` 等生产命名空间，不得含 `..` 或 `//`。使用**专用测试 AccessKey，仅授予该前缀的 Put/Get/Delete 与桶的 GetBucketVersioning/GetBucketLifecycle/List**；不使用 Console 保险箱中的 `oss.default` 生产凭据，也不使用运行时凭据。
- 写模式与只读模式使用同一 bucket，因此在批准前先用默认只读模式确认目标是“专用、从未开启版本控制”的桶（`versioning: NeverEnabled`）以及生命周期规则不覆盖测试前缀。
- 用 `_write-once-proof/` 而不是 `codocs/snapshots/`，避免与 Foundation 写一次命名空间保护（禁止删除）冲突，也不会污染真实快照命名空间。

## 3. 检查项与判定

| 检查 | 内容 |
| --- | --- |
| T0 | 只读：桶版本控制状态、生命周期规则、测试前缀可列 |
| T1 | `PUT a.bin` + `forbid-overwrite`：200，并记录 `x-oss-version-id` 是否可用 |
| T2 | 同 key 再 PUT（不同字节，带保护头）：必须 409 |
| T3 | 带 T1 版本 ID 精确读取：字节一致、响应版本头一致（无可用版本 ID 时跳过） |
| T4 | 不带版本读取：仍是 T1 的字节（T2 没有覆盖） |
| T5 | 8 路并发 PUT 同一新 key（`b.bin`，带保护头）：恰好 1 个 200，其余 409，幸存字节属于赢家 |
| T6 | 可选对照：不带保护头两次 PUT `c.bin`，第二次成功 |
| T7 | 可选清理 |

结论只有五种：

| verdict | 含义 | 后续 |
| --- | --- | --- |
| `PASS_BOTH` | 写一次成立，且每次成功 PUT 返回可精确读回的版本 ID | 可作为该桶的生产发布证据；仍需完成保留/生命周期核对（§4） |
| `FAIL_NO_VERSION_ID` | 写一次成立，但没有可用版本 ID（预期的“从未版本化”桶结果） | 现合同不能上线，走 §5 |
| `FAIL_NOT_WRITE_ONCE` | 有版本 ID，但同 key 可被覆盖（版本化桶） | 不能作为生产桶；同一 key 并发可覆盖 |
| `FAIL_NEITHER` | 两者都不成立 | 检查桶类型与权限 |
| `INCONCLUSIVE` | 必需请求失败（凭据、权限、网络） | 修复后重跑；不得据此下结论 |

## 4. 执行顺序（每步等待用户批准）

1. 创建专用快照桶（从未开启版本控制）与专用测试 AccessKey；生命周期不覆盖 `_write-once-proof/`，也不含 `codocs/snapshots/` 上的过期规则。
2. 主机 `0600` 写配置，运行只读模式，把输出（不含密钥）交用户确认目标桶状态。
3. `--plan --run-id <新随机 16 位十六进制>`，用户审阅 `planHash`。
4. `--write-proof --run-id <同一 id> --confirm <planHash> --overwrite-control --cleanup`。
5. 保存输出（verdict 与各检查），作为“版本 ID 与写一次同时成立/不成立”的证据回写 [写入协调合同](./Codocs-Document-Write-Coordination.md)。
6. 无论结果，撤销专用测试 AccessKey；未 `--cleanup` 时另行批准清理。

`PASS_BOTH` 之后，生产仍须：Runtime 使用的存储集成指向该专用桶；`GetOSSBucketRetention`/`RetainsVersionsUnder` 保留核对通过；Runtime 上传/发布/精确读取在该桶端到端（双人验收）验证。

## 5. 若不能同时成立

不在本批次实现，以下为备选，均需用户决定并走合同变更：

- **A. 改精确引用合同**：对从未版本化的专用桶，以“key + SHA-256 + 长度 + 写一次”作为精确引用，允许 provider 版本 ID 为空（现有校验要求非空非 `null`，需改 Runtime 校验、发布记录列及所有读取路径，并补回滚/迁移与全套负向测试）。
- **B. 使用版本化桶并接受非 provider 级写一次**：靠随机 attempt 目录 + HEAD 降低碰撞，仍存在并发同 key 覆盖窗口；因 attempt 目录由服务端随机生成，实际风险低，但这不是合同要求的“provider 级原子防覆盖”，需要用户明确接受。
- **C. 换存储或加入 provider 支持的条件写（如兼容 S3 的 `If-None-Match`）**：需要先实测目标 provider 是否支持。

## 6. 证据边界

- 已验证（隔离测试）：签名算法（文档已知答案）、只读默认、写入仅限专用前缀、`--plan` 无网络、需要审阅哈希、清理范围、四种桶行为的判定矩阵（进程内模拟 OSS）。
- **未验证**：任何真实 OSS 行为。`never-versioned` 桶是否返回 `x-oss-version-id`、`forbid-overwrite` 的并发语义均来自合同文档的既有说法与公开文档，需要本实测确认。
