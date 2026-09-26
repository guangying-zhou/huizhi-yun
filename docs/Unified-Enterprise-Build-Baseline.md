# ADR-018 构建与配置基线

采集日期：2026-09-13。范围：测试 Aims / Assets 的现存构建产物、Wrangler 只读部署记录、Assets 本地 dry-run。未发布、未执行远程写入、未读取 secrets.json；总进度由实施台账维护。

## 版本与上传测量

| 指标 | Aims | Assets |
| --- | --- | --- |
| Worker | hzy-test-aims | hzy-test-assets |
| 只读 deployments list 最新 100% 版本 | `8d573b11-b6cf-4052-a4a0-d0d6bf7b5a41` | `c6ae2f23-286f-4bb6-95a4-679d456f13b9` |
| 该部署时间 UTC | 2026-09-13 14:38:20.818 | 2026-09-11 18:46:24.591 |
| Wrangler Total Upload | 7678.18 KiB | 5976.49 KiB |
| Wrangler gzip | 2421.27 KiB | 2116.11 KiB |
| Worker startup | 56 ms（该 Aims 历史发布日志） | 未取得；dry-run 不提供实际 startup |
| 测量来源 | 9 月 13 日实际发布日志，与当前最新部署 version ID 一致 | 9 月 13 日现存本地产物 dry-run，不能证明远程构件逐字节一致 |

Aims 证据为 `/tmp/hzy-product-nav-qa-20260913/cf-deploy-final.log` 中 Total Upload、Worker Startup Time 和 Current Version ID；只读 `wrangler deployments list --config deploy/test-env/.cloudflare-workers/aims/wrangler.json` 核对到相同版本。Assets 只读查询对应 config，dry-run 日志 `/tmp/hzy-adr018-assets-dry-run.log`。本地临时日志不是长期存档，本文保存脱敏测量与版本关联；后续发布应在正式 evidence 制品保存原始脱敏日志及 hash。

不能由 Aims 单次 startup=56ms 推断并发 CPU、内存或请求 P95。Assets 本地 dry-run 与远程版本仅时间相符，未做远程构件 hash 对比。

## 配置与调度数量

直接读取两应用 `deploy/test-env/.cloudflare-workers/<app>/wrangler.json` 的非敏感字段并计数，不输出变量值。

| 指标 | Aims | Assets |
| --- | --- | --- |
| vars 项数（不含 secrets） | 59 | 59 |
| Service Binding 项数 | 3 | 3 |
| 配置业务 cron 项数 | 0 | 0 |
| Nuxt 源码 scheduledTasks 时间规则数 | 3 | 1 |
| Nuxt 源码注册 task 数 | 3 | 2 |
| 同路径 Nitro plugin | sync-approval-actions | sync-approval-actions |
| compatibility_date | 2026-06-15 | 2026-06-15 |

两个 59 不能简单相加作为合并后配置量；同名变量可能含不同模块语义，实际收敛以 Host 显式模块配置和绑定为准。源码 task 数不表示当前任务启用；测试 renderer 明确拒绝业务 triggers。cron / outbox 消费权切换仍需专门验收。

## 本地产物大小口径

以下为递归常规文件 `stat().st_size` 字节和，不使用磁盘占用量；采集时尚未重新构建。

| 目录（相对于各 `.cloudflare-workers/<app>`） | Aims 文件数 / 字节 | Assets 文件数 / 字节 |
| --- | --- | --- |
| output/server | 356 / 7,222,779 | 290 / 6,033,374 |
| output/public | 3769 / 60,531,715 | 94 / 1,956,561 |
| output 整体 | 4128 / 67,755,011 | 387 / 7,990,452 |
| assets 静态上传目录 | 3769 / 60,531,715 | 94 / 1,956,561 |
| nuxt 临时目录 | 3912 / 61,731,622 | 241 / 2,843,485 |

`output/public` 与 `assets` 是重复准备的静态资产，不累计成 Worker 上传体积。Aims 静态目录中有大量保留资源；目录总量不能用作首屏 JavaScript 流量，也不能据此判断超过 Worker 限额。现存静态资源可能含兼容旧 chunk，后续先核对消费与缓存窗口再清理。

## 可复用命令

```sh
node_modules/.bin/wrangler deployments list --config deploy/test-env/.cloudflare-workers/aims/wrangler.json
node_modules/.bin/wrangler deployments list --config deploy/test-env/.cloudflare-workers/assets/wrangler.json
node_modules/.bin/wrangler deploy --dry-run --config deploy/test-env/.cloudflare-workers/assets/wrangler.json
```

共享证据时只保留版本、时间、测量和非敏感配置统计；不要完整复制包含环境变量的日志。禁止将 dry-run 改成真实 deploy 作为默认基线动作。

## INT-006 尚缺证据

固定样本、采样口径、阈值、负责人和排期已补入[性能基线](./Unified-Enterprise-Performance-Baseline.md)。当前 Host 已取得一次成功 dry-run，但还不是干净固定提交的三轮构建样本；仍需按协议采集同账号/数据的旧新 P50/P95、Runtime SQL/慢查询、真实套餐 CPU/并发内存和 Assets startup。本文件不支持单独勾选 INT-006。

## Host 产品读取/规划接口组合验证（2026-09-13）

在当前未提交工作树运行 `pnpm --dir enterprise verify:cloudflare` 成功（Nuxt Cloudflare module 构建与 Wrangler `deploy --dry-run`，没有部署）。本轮包含已组合的产品页面、目录/工作空间/需求/版本/计划/组件 BFF；不包含仍在实施的需求后续动作。

- Nitro 本地总产物：5.8 MB，gzip 2.16 MB。
- Wrangler 实际 dry-run 上传口径：5767.21 KiB，gzip 2081.73 KiB。
- 构建存在 Tailwind sourcemap 警告，未阻断打包。

该结果只证明本轮工作树的打包能力和上传体积，不是正式发布制品；没有验证线上启动 CPU、真实绑定、登录后业务链、完整功能或 P50/P95。并行后续代码完成后，在固定发布版本上重新生成制品和验收证据。

## 接入与结构组合后的 Host 预演（2026-09-13）

在当前共享工作树执行 `pnpm --dir enterprise verify:cloudflare`，退出码 0；Wrangler 明确以 `--dry-run` 退出，未发布。日志 `/tmp/hzy-enterprise-current-build.log`。

- Nitro 总产物：5.86 MB，gzip 2.18 MB。
- Wrangler 上传口径：5828.11 KiB，gzip 2092.50 KiB。
- 包含当前已挂载的产品结构页面及接入/组件 BFF 组合。功能目录及版本生命周期仍有并行接线，不将工作树构建称为固定正式版本。
- Tailwind sourcemap 警告仍存在；没有构建错误。

此记录更新当前可打包证据，不替代实际 Worker CPU/内存、正式权限与 OIDC、登录后业务页面、迁移和恢复验收。正式发布仍需固定提交与完整源码/构件关联清单。

## 功能目录与版本验收页面组合预演（2026-09-13）

当前共享工作树的 `pnpm --dir enterprise verify:cloudflare` 退出码 0，日志 `/tmp/hzy-enterprise-integrated-build.log`。Nitro 总产物 5.98 MB（gzip 2.22 MB）；Wrangler 上传口径 5919.51 KiB（gzip 2103.70 KiB），明确以 `--dry-run` 退出，未部署。已包含新增功能详情、版本验收与历史记录页面组合；并行开发中的历史记录接口和恢复路径仍须在最终固定版本重新验证。此结果仅证明当前组合可构建，不证明业务验收、真实权限或迁移就绪。

## 2026-09-15 当前工作树复测

当前 `enterprise/.output` 是既存产物，共 315 个常规文件、7,486,514 bytes；它不是本次成功构建结果，不能与 HEAD 建立完整性绑定。当前测试渲染配置的非秘密结构计数如下，统计时只读取键名和数组长度：

| 应用 | vars 键数 | Service Bindings | 配置 cron | queue consumers |
| --- | ---: | ---: | ---: | ---: |
| Enterprise Host | 17 | 1 | 0 | 0 |
| Aims | 59 | 3 | 0 | 0 |
| Assets | 59 | 3 | 0 | 0 |

源码中 Aims 仍登记 3 条 scheduled 时间规则/3 个 task，Assets 为 1 条规则/2 个 task，Enterprise Host 没有业务 scheduled task。它们是声明数量，不代表远端启用或唯一 owner；切换后的实际触发者由 INT-001/206 验收。

本地执行 `/usr/bin/time -l pnpm --dir enterprise verify:cloudflare`，只运行构建和 Wrangler dry-run，没有部署。构建在 4.58 秒处因 Assets 字典页面引用的 `shared/assetCategoryDefaults` 无法从 Enterprise Layer 解析而失败；进程总 wall 7.57 秒、峰值 RSS 1,289,846,784 bytes。失败发生在产生可上传构件前，因此不记录新的 Wrangler 上传大小，也不把该耗时当成功构建基线。该缺口须由对应页面整合工作修复；INT-006/307 不能依据 9 月 13 日旧构件通过。

### Layer 解析修复后的单次成功 dry-run

修复提交：`162b49b9`。同一命令随后退出码为 0，Wrangler 明确输出 `--dry-run: exiting now`，没有发布或修改远端环境。采样时共享工作树仍有另一 Aims 工作包的未提交文件，因此以下 SHA-256 固定本次**实际输出字节**，不能把结果称为只由 `162b49b9` 干净 checkout 生成的发布制品。

| 指标 | 单次观测 |
| --- | ---: |
| Nitro 总大小 / gzip | 6.09 MB / 2.26 MB |
| Wrangler Total Upload / gzip | 6040.50 KiB / 2122.14 KiB |
| `.output` | 403 文件 / 7,719,458 bytes |
| `.output/server` | 300 文件 / 6,094,975 bytes |
| `.output/public` | 100 文件 / 1,623,966 bytes |
| wall / user / sys | 19.74 s / 30.52 s / 4.76 s |
| maximum resident set size | 3,242,016,768 bytes |
| output inventory SHA-256 | `3ece26df6ff22c8c49e99c90b344bb246c5f192643df79880bc08ccd2f84cd5d` |
| server entry SHA-256 | `d86fa466864866783f09dd3261995215ff3afb13886897c22dd5fc8767f57ef4` |

上传量低于 51.2 MiB 门禁；wall 低于 120 秒。峰值 RSS 比冻结的 3 GiB（3,221,225,472 bytes）阈值高 20,791,296 bytes，单次结果不能通过构建内存门禁。构建还报告两项 esbuild 警告：`foundation/server/utils/tenantGatewayTrust.ts` 和 `aims/server/utils/productExecutionCoordinationVisibility.ts` 含 BigInt literal，而目标为 ES2019，可能在运行时崩溃；另有不阻断构建的 sourcemap 警告。必须先处理或明确验证 BigInt 运行兼容，再从干净固定提交执行冷/暖各三轮。此次成功只关闭 Layer 路径解析 blocker，不完成 INT-006/307。

### 固定提交三轮本地 dry-run（2026-09-15）

被测提交固定为 `bc34d112571af3acdb218464d97558ac0e868df4`。在 detached 临时 git worktree 中只复用主工作区已安装的依赖，先为 Foundation/Aims/Assets/Enterprise 生成本地 Nuxt 类型，再连续执行三轮与 `verify:cloudflare` 等价的配置渲染、Cloudflare module 构建和 `wrangler deploy --dry-run`；未读取用户 env、未包含主工作区未提交文件、未部署，测试后已移除临时 worktree。本组属于**固定源码、暖依赖缓存**样本，不冒充冷依赖安装样本。

| 轮次 | Wrangler upload / gzip | `.output` | Nitro server / gzip | wall / user / sys | 最大 RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 6064.82 / 2142.86 KiB | 415 文件 / 7,768,170 bytes | 6.13 / 2.28 MB | 19.57 / 32.58 / 5.27 s | 3,414,376,448 bytes |
| 2 | 6064.82 / 2142.85 KiB | 415 文件 / 7,768,170 bytes | 6.13 / 2.28 MB | 20.69 / 34.25 / 6.51 s | 2,595,913,728 bytes |
| 3 | 6064.82 / 2142.84 KiB | 415 文件 / 7,768,170 bytes | 6.13 / 2.28 MB | 17.98 / 31.66 / 4.16 s | 3,503,898,624 bytes |

三轮 `.output/server/index.mjs` SHA-256 均为 `4e2646a9c2c202f773e8d5526c49ea947819113b8751fbab32118277fd17cc5c`，文件数、总字节数、server（308 文件 / 6,126,166 bytes）及 public（104 文件 / 1,641,487 bytes）也完全相同。完整 inventory SHA-256 分别为 `1f978774b190da89da53c3c352f879c036f51697b9c1080791040c686fef0468`、`9b4d6b0db87bc5afda8bcc69c75cec89179a9d72eac0ea4637116129f3292cbc`、`83e67399982f153e0c3b1bd51d4ffef2beb1e24b23189554ecfcde02f7fa5c40`。诊断对比确认差异来自 Nuxt 每轮生成的 build ID：`.output/nitro.json`、`public/_nuxt/builds/latest.json`、对应随机 UUID meta 文件及引用该 ID 的 `server/chunks/nitro/nitro.mjs`；其余文件逐项 SHA 稳定。因此当前构件在功能入口和大小上可重复，但不是逐字节可重复构建。三轮均只有既有 sourcemap 警告，没有此前的 ES2019 BigInt 兼容警告。

按三样本 nearest-rank 口径，wall P95 为 20.69 秒，低于 120 秒阈值；上传量约 5.92 MiB，低于 51.2 MiB 门禁。最大 RSS P95 为 3,503,898,624 bytes，且三轮中两轮超过 3 GiB 门禁，所以 INT-006 仍不能完成。当前 `/usr/bin/time` 包住整条命令，只能确认组合峰值，不能可靠归因到 Nuxt 或 Wrangler。下一步应分别测量配置渲染、Nuxt client/server bundle 和 Wrangler 打包子进程，并优先检查 1,991-module client graph、438.04 kB 最大 client chunk及 Host 同时挂载模块造成的编译峰值；取得分段 RSS 后再决定拆 chunk、缩小 Layer 扫描或调整构建并发，不能用提高阈值代替定位。

### 关闭 Host sourcemap 后的分段三轮（2026-09-15）

优化提交为 `d658d022`：只在 Enterprise Host 明确关闭 client/server sourcemap，独立 Aims/Assets 和业务行为不变，并以拓扑测试锁定该构建合同。固定该提交的 detached 临时 worktree 复用同一暖依赖缓存；每轮分别用 `/usr/bin/time -l` 测量配置渲染、Nuxt build 和 Wrangler dry-run，避免把父 shell 的组合峰值误归因给某个阶段。三轮后已移除 worktree，全程未部署、未读取用户 env。

| 轮次 | Nuxt wall / user / sys | Nuxt 最大 RSS | Wrangler wall / user / sys | Wrangler 最大 RSS | upload / gzip |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 22.96 / 32.22 / 5.59 s | 2,518,499,328 bytes | 1.23 / 1.47 / 0.19 s | 321,617,920 bytes | 6069.00 / 2143.14 KiB |
| 2 | 18.85 / 30.28 / 4.24 s | 3,104,636,928 bytes | 1.16 / 1.40 / 0.17 s | 321,077,248 bytes | 6069.00 / 2143.13 KiB |
| 3 | 24.95 / 33.31 / 5.37 s | 2,005,467,136 bytes | 1.39 / 1.53 / 0.18 s | 303,480,832 bytes | 6069.00 / 2143.13 KiB |

配置渲染最大 RSS 为 44,810,240 bytes；峰值明确来自 Nuxt build，不来自 Wrangler。Nuxt RSS P95 为 3,104,636,928 bytes，三轮均低于 3 GiB 门禁；Nuxt wall P95 为 24.95 秒。优化后 Nitro 为 5.89 MB（gzip 2.18 MB），`.output` 从 415 文件 / 7,768,170 bytes 降至 263 文件 / 7,536,957 bytes，构建日志不再列出 `.mjs.map`。在同一 worktree 恢复 sourcemap 默认值做 A/B 对照，Wrangler upload 同为 6069.00 KiB，因此优化没有增加上传量；上传口径未因本地 `.map` 删除而虚构下降。

三轮 server entry SHA-256 均为 `46e5ab0d6922d33dc3be394934269391c9aa64440b752488393f555b65c2c084`；完整 inventory 仍因 Nuxt 随机 build ID 不同。最大 client chunk 仍约 438.04 kB，server 最大来源仍是 Iconify 集合 bundle；本次没有删除图标集合，因为应用目录可提供动态图标名称，静态扫描试验只识别 3 个图标，会造成实际功能缺失。后续若继续压缩上传量，应先冻结动态图标白名单再裁剪集合。

本批次关闭了固定暖依赖构建的 3 GiB RSS 缺口，但 INT-006 仍缺冷依赖三轮、真实 Worker CPU/startup/并发内存、两租户旧新配对及 Runtime SQL/慢查询证据，不能据此勾选 INT-006。


## 审批与 IP 候选收口后的本地构建（2026-09-15）

提交 3fe32c87 的功能批次收口后，在共享整合工作树执行 `/usr/bin/time -l pnpm --dir enterprise build:cloudflare`，exit 0。这是单次工作树构建证据，不是 detached 固定提交的冷/暖三轮性能样本；并行迁移审计改动未作为部署制品发布。

Nuxt client 7.616 秒，server 0.017 秒；总体 wall 17.83 秒，最大 RSS 2,969,223,168 bytes，低于 3 GiB 本地构建门禁。Nitro 输出总量 5.95 MB（gzip 2.18 MB），该数字不代替 Wrangler Total Upload。脱敏测量取自 `/tmp/hzy-enterprise-3fe32-build.log`，未执行 deploy 或读取用户 Runtime env。实际上传、Worker startup/CPU/并发内存、浏览器与 SQL 指标仍待验证；INT-006/307 不勾选。
