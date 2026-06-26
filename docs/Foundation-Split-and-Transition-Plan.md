# Foundation 拆分与过渡方案

## 1. 文档目标

本文档用于定义 `foundation` 在新平台建设阶段的拆分方向与过渡策略。

重点回答以下问题：

- `foundation` 为什么必须拆分
- UI 和 SDK 应如何分层
- `platform-sdk` 是否应该最终发布为 npm 包
- 在不打断现有应用的前提下，如何完成从旧 `foundation` 到新平台接入层的演进

---

## 2. 当前问题

当前 `foundation` 同时承担了多类职责：

- 公共 UI / Layout / 组件
- 认证态消费
- 权限消费
- 路由守卫
- 服务端鉴权封装

这在早期是高效率的，但在平台化阶段会出现明显问题：

### 2.1 协议逻辑与 UI 耦合

token、权限、bundle、鉴权等运行时逻辑如果继续和 UI 混在一起，会导致：

- 非 Nuxt / 非 Vue 场景无法复用
- 业务 app 很难清楚知道哪些是平台协议能力，哪些只是 UI 组件
- 后续 `AIMS`、`Codocs`、其他 app 接入边界越来越混乱

### 2.2 旧应用与新平台难以并行演进

如果所有能力都继续堆在同一层里，会出现：

- 旧应用要兼容旧逻辑
- 新应用要接新平台协议
- 最终同一个模块里长期并存两套模型

### 2.3 无法为未来客户侧 runtime 提供独立 SDK

平台未来需要的核心能力，例如：

- token 验签
- claims 解析
- bundle 拉取与缓存
- revocation 校验
- `checkPermission()`
- heartbeat client

这些都不应该依赖 Nuxt 或 UI。

---

## 3. 拆分目标

`foundation` 的拆分目标不是简单分成“UI”和“非 UI”两坨，而是分成三层。

### 3.1 `platform-sdk`

职责：

- 纯平台运行时能力
- 不依赖 Vue / Nuxt / UI 组件
- 负责：
  - token 验签
  - claims 解析
  - bundle 拉取与缓存
  - revocation 校验
  - permission snapshot 计算/消费
  - `checkPermission()`
  - heartbeat client
  - manifest 消费

### 3.2 `platform-adapter-nuxt`

职责：

- 将 `platform-sdk` 接入 Nuxt/Nitro
- 负责：
  - request context 注入
  - route middleware
  - composables 包装
  - SSR 会话注入
  - 菜单权限注入
  - server auth helper

### 3.3 `foundation-ui`

职责：

- 纯 UI / 组件 / Layout / 主题
- 不直接理解 token、bundle、权限解析
- 最多只消费 adapter 暴露的已加工状态

---

## 4. 推荐分层关系

建议关系固定为：

`platform-sdk <- platform-adapter-nuxt <- foundation-ui / apps`

含义是：

- `platform-sdk` 是最底层平台协议能力
- `platform-adapter-nuxt` 负责框架集成
- `foundation-ui` 和业务应用只能通过 adapter 消费平台能力

这样可保证：

- SDK 不被 UI 污染
- UI 不直接耦合平台协议细节
- app 的依赖路径清晰

---

## 5. 过渡原则

拆分不能一步到位，必须有过渡方案。

### 5.1 先逻辑拆分，后物理拆分

第一阶段先在同一代码库内完成模块边界拆分，不急于：

- 拆仓库
- 独立发版
- 迁出所有旧代码

### 5.2 先稳定 SDK 契约，后迁 UI

真正要先稳定的是：

- token / bundle / revocation / permission 的 SDK 接口

而不是先急着移动 UI 文件。

### 5.3 旧应用先走兼容 facade

`Codocs` 等旧应用在过渡期内不应直接被强制切到全新接口。  
应该保留一个兼容层，将旧入口逐步转调到新 adapter / SDK。

### 5.4 AIMS 作为新接口首个消费者

`AIMS` 应直接走：

- `platform-sdk`
- `platform-adapter-nuxt`

不再新增对旧 `foundation` 鉴权逻辑的依赖。

---

## 6. 推荐目录形态

即使第一阶段不拆仓，也建议按 package 形态组织。

建议结构如下：

- `foundation/packages/platform-sdk`
- `foundation/packages/platform-adapter-nuxt`
- `foundation/packages/foundation-ui`
- `foundation/packages/legacy-auth-bridge`

其中：

### 6.1 `platform-sdk`

目标：

- 未来可独立构建
- 未来可独立版本化
- 最终可独立发 npm 包

### 6.2 `platform-adapter-nuxt`

目标：

- 将 SDK 接入 Nuxt/Nitro
- 对现有 app 提供最平滑的接入方式

### 6.3 `foundation-ui`

目标：

- 承接纯 UI
- 从旧 `foundation` 中逐步剥离布局、组件、样式层

### 6.4 `legacy-auth-bridge`

目标：

- 给旧应用保留兼容入口
- 内部逐步转调新 adapter / SDK
- 避免 `Codocs` 在拆分初期被直接打爆

---

## 7. platform-sdk 的定位

### 7.1 短期定位

短期内，`platform-sdk` 应作为 monorepo 内部包存在。

也就是说：

- 可以独立构建
- 可以独立测试
- 可以独立版本化
- 但先不急着对外正式发布

### 7.2 长期定位

长期看，`platform-sdk` 应成为正式 SDK 包。

这是因为它承载的是可复用的、跨应用的、跨框架的核心能力：

- token
- claims
- bundle
- revocation
- permission
- heartbeat

这些天然适合抽成独立包。

### 7.3 现阶段为什么不急着发 npm

因为当前仍处于平台协议和首批 app 接入验证期：

- `hzy_platform` 还在建设
- `AIMS` 还未跑完首条完整链路
- `Codocs` 还未进入兼容接入
- SDK API 还可能继续收敛

如果过早发包，会过早背上：

- 版本兼容负担
- 发布节奏负担
- 升级支持负担

因此建议：

- 先按“可发包”的标准设计
- 先在 monorepo 内消费
- 等 `AIMS` 跑通后再正式发布

---

## 8. 对 platform-sdk 的硬性约束

建议从第一天起就设以下边界：

### 8.1 禁止引入 Vue / Nuxt 依赖

`platform-sdk` 必须是纯平台 core，不允许直接依赖：

- Vue composables
- Nuxt runtime
- UI 组件库

### 8.2 禁止直接依赖业务 app 代码

SDK 只能处理平台通用语义，不能直接理解：

- `AIMS` 项目成员
- `Codocs` 文档协作关系

这些应由各 app 自己实现 resolver。

### 8.3 输出稳定、框架无关接口

例如：

- `verifyToken()`
- `loadBundle()`
- `loadRevocationSnapshot()`
- `buildAuthorizationSnapshot()`
- `checkPermission()`
- `createHeartbeatClient()`

### 8.4 UI 不得绕过 adapter 直连 SDK

UI 层和页面层不应各自直接拼 token / claims / bundle 逻辑。  
必须经由 adapter 统一接入。

---

## 9. 过渡实施步骤

建议按以下顺序推进。

### Step 1：梳理现有 foundation 中的鉴权相关代码

输出：

- 哪些属于 UI
- 哪些属于 Nuxt 适配
- 哪些属于平台协议 core

### Step 2：抽出 `platform-sdk`

优先抽：

- token 验签
- claims 解析
- bundle / revocation 消费
- permission snapshot / `checkPermission()`

### Step 3：实现 `platform-adapter-nuxt`

优先补：

- server auth helper
- route middleware
- composables facade
- menu filtering adapter

### Step 4：保留 `legacy-auth-bridge`

让现有 app 暂时仍可走旧入口，但内部逐渐转调到新 adapter / SDK。

### Step 5：AIMS 直接接新层

要求：

- 新功能不得依赖 legacy bridge
- 以 `AIMS` 验证新 SDK 契约是否成立

### Step 6：Codocs 再逐步切到 bridge -> adapter

要求：

- 不一次性切所有入口
- 先切登录、路由守卫、服务端 auth helper

### Step 7：最后清理 foundation-ui

把剩余纯 UI 资产彻底从鉴权逻辑中解耦。

---

## 10. 风险与控制

### 10.1 只拆目录，不拆边界

风险：表面拆了，实质仍然混在一起。  
控制：先定义职责，再移动代码。

### 10.2 过早发布 npm 包

风险：API 尚未稳定就背上外部兼容负担。  
控制：先内部包，后正式发布。

### 10.3 legacy bridge 长期不下线

风险：新旧两套接口永久并存。  
控制：AIMS 不允许接 legacy，Codocs 接入后设清理计划。

### 10.4 UI 仍直接操作权限逻辑

风险：平台协议再次在页面层扩散。  
控制：所有权限消费统一经 adapter。

---

## 11. 验收标准

拆分第一阶段完成后，应满足以下标准：

### 11.1 SDK 层

- `platform-sdk` 可独立构建
- 不依赖 Vue / Nuxt
- 能独立完成 token / bundle / permission 相关核心逻辑

### 11.2 Adapter 层

- `platform-adapter-nuxt` 可为 Nuxt app 提供统一鉴权接入
- 能支撑 route middleware、server auth helper、composables facade

### 11.3 UI 层

- UI 组件和 layout 不再直接包含平台鉴权核心逻辑

### 11.4 应用层

- `AIMS` 已成为新接口消费者
- `Codocs` 仍可通过 bridge 保持兼容

---

## 12. 推荐下一步

如果采用本方案，建议下一步直接继续输出两份材料：

1. `platform-sdk` API 草案  
2. `foundation` 现有代码拆分清单

---

## 13. 结论

`foundation` 的正确拆分方向，不是简单分成“UI”和“SDK”，而是拆成：

- `platform-sdk`
- `platform-adapter-nuxt`
- `foundation-ui`
- `legacy-auth-bridge`

其中，`platform-sdk` 长期应成为正式 npm 包，但当前阶段应先作为 monorepo 内部包稳定下来，等 `AIMS` 完成首个完整接入后再正式发布。
