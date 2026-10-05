# K2-E：离线证据包与精简封存

本目录提供受保护本地材料的 schema、固定序列化、时间校验、provider 恢复副本只读采集与精简封存 CLI。原 `draft` 和 `validated-local-structure` 模式仍只验证本地结构，**不是** Platform 审批、实际停写证明或 Go 激活许可。新的 `seal-cli.mjs` 仅在材料闭包和绑定通过后输出 HMAC 封存请求；Platform 签发与 Go 激活仍有独立验证。Cloudflare、systemctl、原源库与 nginx 观测必须由受控只读流程取得并由员工审阅；本目录不会替操作员声明现场已停写。

## 合成演示

```bash
evidence_dir="$(mktemp -d)"
chmod 700 "$evidence_dir"
node deploy/self-hosted/cutover/test/make-fixture.mjs "$evidence_dir"
node deploy/self-hosted/cutover/cli.mjs build --manifest "$evidence_dir/manifest.json" --out draft.json --mode draft
node --test deploy/self-hosted/cutover/test/*.test.mjs
```

`--mode validated` 仅在 systemd 提供 `CREDENTIALS_DIRECTORY` 时，从其中的 `offline-drain-hmac` 读取恰好 32 字节的凭据，生成标为 `localMac` 的**本地结构完整性**摘要。不接受命令行凭据路径、普通环境变量中的秘密或生产 env fallback。测试只用一次性 0600 合成文件。文件与父目录须由进程所有，分别不得有组/其他权限；输入是固定序列化 JSON（ASCII key 升序、NFC 字符串、整数、UTF-8、单 LF），每件最多 32 MiB、整包最多 128 MiB。CLI 在读取任何观测文件前先验证种类/文件名闭包，逐件累计字节数，越限立即停止且不保留全部原始 Buffer。输出文件创建为 0600，原子链接落地且拒绝覆盖；CLI stdout 只有状态与摘要，错误只打印固定机器码。

## 合同与后续接口

- `enterprise-offline-evidence-input.v1` 指定 tenant/environment、cutoverKey/generation、目标 instance/deployment、phase P/Q 和所需**文件基名**；文件不能包含路径分隔符。每个 `enterprise-offline-observation.v1` 重复精确绑定、采集起止时间、kind、collector 标签和结构化结果。
- P 需要 C2 两轮原库表指纹、dump/provider 摘要链接及四类当前状态；Q 需要 C2 第二轮、批准 payload hash/时间/P 最早观测时间及四类再次采集。C2 第二轮必须早于 P 最早观测、批准和 Q 采集；P/Q 原库表行必须与 C2 第二轮相等。source 表项的 schema/table/count/checksum 全为字符串，source 与链接结果对象只接受规定字段。现有合成表集只证明接口运作，真实采集须按 Runbook 完整枚举九库并通过独立材料闭包校验。
- `collectObservations(adapter,binding,files)` 是后续只读采集端口；本批只有 `protectedFileCollector`，它从本地合成文件取原始字节，不能把文件中的 `collector` 文本当作受认证采集身份。`dump-link`、`provider-report` 的 SHA-256 在本批只是待复核链接，不代表已读取或认可目标材料。
- `FIXED_LIMITS` 是待 S3 测量的候选上界：C2 至少间隔 5 分钟，P/Q 采集跨度 ≤10 分钟，P 从最早观测起 30 分钟，Q 从最早观测起 10 分钟，批准 15 分钟，Q 签名到首次激活 2 分钟，未来偏差 30 秒。材料不能修改上界。`activationDeadline` 纯函数算出四项最小截止；最终签名、可信当前时间和 Go 激活前再检查由后续批次实现。

本批与 [已审设计](../../../docs/Enterprise-Offline-Drain-Evidence-Design.md)一致，生产离线切换仍不得调用测试 coordinator 或 `enterprise-drain-release.v1`。

## 精简封存与 provider 回执

受保护目录中的 `enterprise-offline-provider-collection.v1` 配置包含恢复副本的只读 MySQL 连接和经审阅的七项 provider 绑定。`provider-report-cli.mjs collect --config <0600-config> --out provider-report.json` 在只读一致快照内调用现有 provider 回执分类器，输出 0600 的规范 JSON 与 SHA-256；只允许在恢复副本执行，不连接原生产写库。配置和输出均不得提交。`provider-report` 观测文件的 `result.sha256` 必须等于该报告的原始规范字节摘要。

`seal-cli.mjs seal --manifest <manifest> --report <provider-report.json> --profile <0600-profile> --actors <actors.json> --cold-archive <cold.json> --out-prefix <prefix>` 使用与原结构校验相同的八份受保护 P 材料及 systemd `offline-drain-hmac` 凭据。四项 M4 状态必须闭合；两轮源库表摘要必须一致。冷存档清单须为 Finance、People、Altoc、Webdev 各提供一份同目录 0600 人工材料，逐份计算原始 SHA-256 并与清单比对。输出 `<prefix>.evidence.json` 与 `<prefix>.request.json` 均为 0600、不可覆盖，stdout 仅给文件摘要。请求内不放入 profile 的数据库连接字段或 HMAC 凭据。

操作员在请求 JSON 中填入逐项人工 `decisions`、四项 `coldArchiveReviews`、`requestId` 与 `approvalReference`，经 Platform `ops.deployments:admin` 页面导入。Platform 在 plan 和 approve 都复算证据文件原始字节摘要、八份材料闭包、provider 报告摘要、profile 固定 kid/公钥指纹与活动签名密钥，并重新分类 provider；同一 tenant/environment/cutoverKey/generation 只保存一次签名制品，完全相同的请求只回放原字节。Platform 生产签发只从 systemd credential 读取 HMAC；普通环境变量仅供非生产隔离测试。新 schema 迁移 `20260929-enterprise-external-drain-generation.sql` 必须先于新代码启用；旧审批无签名制品，不可重放。生产采集来源和人工证据须在 S3 演练逐项复核，结构校验不代替对原 Cloudflare、Runtime、源库和 nginx 的现场只读采证。
