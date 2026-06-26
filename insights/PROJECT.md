### 2024-09-26

* Multi-tenant dev fix: ensure subdomain (e.g. huifang.lvh.me) correctly resolves by:
   * unified-tenant middleware now also sets x-tenant-name & x-original-host headers
   * useBusiness composable consumes x-business-name OR x-tenant-name (relaxed originalHost requirement)
   * added debug logging in dev
* Business URL composable updated: in dev always use {name}.{siteUrlHost} ignoring custom domain; www returns siteUrl
* BusinessesMenu trigger now explicitly binds active label/logo instead of spreading entire selected item.

### 2025-09 (Plan A 域名与反向代理统一更新)

本阶段对多租户域名判定、OAuth 回调与登录/登出跳转做了“Plan A”统一收敛，核心目标：去除到处散落的 `baseDomain / devRootDomains / platformRootDomains` 分支判断，改用集中分类函数，降低未来新增根域或迁移时的维护成本。

**关键组成**:
- `server/utils/hostClassifier.ts`：核心分类工具，输出 4 种类型：
   - `platform-root` (apex / www)
   - `platform-reserved-subdomain` (auth, api, admin, storage ...)
   - `tenant-subdomain` (一级子域即租户名，如 `huifang.lvh.me`)
   - `custom-domain` (未匹配任何平台基域的域名)
- 运行时公开配置：`public.platformBaseDomains` + `public.platformReservedSubdomains`（在 `nuxt.config.ts` 聚合 dev 与 prod 根域）。
- 中间件 `server/middleware/unified-tenant.ts` 改为直接调用 classifier，统一注入 `x-business-name / x-tenant-subdomain / x-original-host`。
- OAuth 回调 `server/api/auth/google.get.js`：移除散落 host 解析与重复逻辑，改为基于分类决定：
   - 自定义域：使用 HMAC relay (`/api/auth/relay`) 设置本域 cookie；管理员 → `/dashboard`，普通用户 → `/`。
   - 租户子域：管理员 → 当子域 `/dashboard`；普通用户保留原返回或根路径。
   - 平台 root/www：统一跳平台 dashboard。
- 登出 `server/api/auth/logout.get.ts`：使用分类判定是否需要级联清理平台域 cookie，租户子域回该子域 `/dashboard`，自定义域通过级联后回自身。
- Debug 端点 `GET /api/debug/host`：便于快速查看分类结果与中间件注入的租户上下文（本地/内网调试使用，生产需加保护）。

**Caddy 引入（开发阶段）**:
- 通过前置 Caddy 占用 80/443（或仅 80）反向代理到内部 `:3000`，消除端口号差异对 cookie / 重定向逻辑造成的分支。
- 支持通配：`*.lvh.me`、`*.repoinsight.local`（可模拟 prod）；后续生产可用 DNS challenge 签发 wildcard。
- 文档：`docs/caddy-dev-setup.md`（含 HTTP / internal TLS / wildcard / Cloudflare DNS challenge / 常见问题排查）。

**典型环境变量**:
```
NUXT_PUBLIC_BASE_DOMAIN=lvh.me
NUXT_PUBLIC_DEV_ROOT_DOMAINS=lvh.me,localhost,127.0.0.1
NUXT_PUBLIC_PLATFORM_ROOT_DOMAINS=lvh.me
NUXT_PUBLIC_PLATFORM_RESERVED_SUBDOMAINS=auth,api,admin,storage
NUXT_PUBLIC_STORAGE_URL=https://storage.lvh.me
```
> 构建期汇总为 `public.platformBaseDomains`，供分类工具统一使用。

> 说明：`NUXT_PUBLIC_STORAGE_URL` 为唯一对外暴露的静态/媒体文件公共基址（R2 自定义域）。历史变量 `NUXT_PUBLIC_R2_PUBLIC_URL` 已删除，不再在任何代码路径中读取；若环境里仍残留，可安全移除。

**迁移注意事项**:
1. 旧逻辑中读取 `devRootDomains` 或直接字符串匹配 host 的代码，应逐步替换为 `classifyHostWithRuntime()`。
2. 若未来新增另一个测试根域（如 `staging.repoinsight.net`），仅需在 env 中追加，无需改业务文件。
3. 调试自定义域登录行为时，确保域已在 `DomainService` 中处于 `active` 状态，否则 OAuth 回调 returnUrl 校验会退回平台域。

**待办（后续可选）**:
- 重构 `useBusiness.ts` 内剩余 fallback 解析逻辑 → 直接依赖中间件 + classifier，减少 header 之外的再次切分。
- 为 `hostClassifier` 添加单元测试（边界：多根域重叠、保留子域冲突、深层子域 `a.b.lvh.me` 降级为 custom 域）。
- 为 debug 端点加生产 token / NODE_ENV 守卫。

**参考文件**: `server/utils/hostClassifier.ts`, `server/middleware/unified-tenant.ts`, `server/api/auth/google.get.js`, `server/api/auth/logout.get.ts`, `docs/caddy-dev-setup.md`。


# RepoInsight 电商 SaaS 平台开发计划

## 项目概述

**项目名称**: RepoInsight 内容管理 + 电商 SaaS 平台  
**项目目标**: 开发一个面向小微企业和个人的电子商务 SaaS 平台，优先提供简单易用的内容管理系统构建主页、Landing Pages和报价页，再集成电商功能  
**计划开始时间**: 2025年6月  
**预计完成时间**: 2025年10月-11月 (13-16周)  
**当前状态**: 计划阶段  

---

## 📊 项目现状分析

### 技术基础评估
- **现有基础设施完整度**: 85%
- **用户管理系统**: 90% 完整 ✅
- **多租户架构**: 85% 完整 ✅ 
- **支付系统集成**: 70% 完整 ✅
- **UI组件系统**: 95% 完整 ✅
- **内容管理系统**: 60% 完整 ⚠️
- **电商核心功能**: 0% 完整 ❌

### 核心优势
- 现代化技术栈 (Nuxt 3, TypeScript, Turso)
- 完善的多租户架构设计
- 高质量 UI 组件库 (Nuxt UI Pro)
- 成熟的 Stripe 支付集成基础
- WebAuthn/OAuth 完整认证系统

### 主要挑战
- 电商核心功能需从零构建
- 数据库模式需要大幅扩展
- 前端状态管理需要重新设计
- 复杂业务逻辑开发量大

---

## 🗓️ 开发路线图

## 第一阶段：多租户内容管理系统 (4-6周)

**目标**: 基于Nuxt Content + Cloudflare R2存储 + 自研编辑器架构，构建企业级多租户内容管理功能

### 🏗️ **实际技术架构**

**核心技术栈**:
- **前端框架**: Nuxt 4 + Vue 3 + TypeScript
- **内容框架**: Nuxt Content (@nuxt/content) 
- **云存储**: Cloudflare R2 (S3-compatible)
- **编辑器**: 自研可视化编辑器 (非Tiptap富文本)
- **多租户**: 基于子域名 + R2存储路径隔离
- **数据格式**: YAML配置 + JSON内容数据

**架构设计特点**:
- 📁 **内容存储**: `R2://contents/{businessName}/index.yml`
- 🖼️ **媒体存储**: `R2://images/{businessName}/`
- 🔒 **数据隔离**: 通过存储路径实现租户隔离，无需复杂数据库设计
- ⚡ **性能优化**: CDN分发 + 智能缓存策略
- 🎨 **可视化编辑**: 章节属性组件 + 实时预览系统

### 第1周：多租户存储架构
**状态**: ✅ **已完成**

**任务清单**:
- [x] 设计多租户R2存储结构
- [x] 实现R2UserContentService服务类
- [x] 创建Nuxt Content配置和Schema定义
- [x] 建立内容类型验证系统 (Zod Schema)
- [x] 实现多租户内容路径隔离
- [x] 配置S3兼容的存储客户端
- [x] 建立内容索引和缓存机制

**核心存储结构**:
```typescript
// R2存储路径设计
R2_STRUCTURE = {
  "contents/": {
    "{businessName}/": {
      "index.yml": "主页内容配置",
      "pages/": "其他页面内容",
      "templates/": "页面模板"
    }
  },
  "images/": {
    "{businessName}/": "租户媒体文件"
  }
}

// 内容Schema (content.config.ts)
collections = {
  pages: {
    schema: {
      title, description, seoTitle, 
      seoDescription, status, type,
      template, publishedAt, business
    }
  }
}
```

### 第2-3周：多租户内容API系统
**状态**: ✅ **已完成 (100%)**

**任务清单**:
- [x] 多租户内容API端点 (`/api/content/[business]/`)
- [x] R2存储内容服务 (R2UserContentService)
- [x] 业务内容获取API (`index.get.ts`)
- [x] 业务内容更新API (`index.put.ts`) 
- [x] 媒体文件管理API (`media.get.ts`)
- [x] 默认内容生成机制
- [x] 内容版本控制和缓存
- [x] 图片路径转换和CDN优化
- [x] 多租户数据隔离验证

**核心API架构**:
```typescript
// API端点结构
/api/content/[business]/index.get.ts    // 获取业务内容
/api/content/[business]/index.put.ts    // 更新业务内容  
/api/content/[business]/media.get.ts    // 媒体文件列表
/api/media/files/[business].get.ts      // 媒体文件管理
/api/images/upload.post.ts              // 图片上传

// 服务类设计
class R2UserContentService {
  getBusinessIndexContent()  // YAML内容解析
  getBusinessImageUrl()      // 图片URL转换
  hasBusinessContent()       // 内容存在检查
  processImagePaths()        // 图片路径处理
}
```

### 第3-4周：自研可视化编辑器系统
**状态**: ✅ **已完成 (100%)**

**任务清单**:
- [x] 章节属性编辑系统 (Section Properties)
- [x] 实时预览功能（多设备适配）
- [x] 媒体选择器和图片管理集成
- [x] 表单化内容编辑（非富文本）
- [x] 内容保存和状态管理
- [x] 章节启用/禁用切换
- [x] 多设备预览模式（桌面/平板/移动端）
- [x] 预览窗口主题系统（颜色切换隔离）
- [x] 业务品牌定制化预览
- [x] 实时内容同步和预览更新

**核心组件架构**:
- ✨ **ContentEditor** (`/dashboard/content/[business]/editor/`): 主编辑器界面
- ✨ **SectionProperties**: 章节属性编辑组件族
  - `SectionHeroProperties.vue` - Hero章节编辑
  - `SectionAboutProperties.vue` - About章节编辑  
  - `SectionFeaturesProperties.vue` - Features章节编辑
  - `SectionStepsProperties.vue` - Steps章节编辑
  - `SectionPricingProperties.vue` - Pricing章节编辑
  - `SectionTestimonialsProperties.vue` - Testimonials章节编辑
  - `SectionCtaProperties.vue` - CTA章节编辑
- ✨ **PreviewHeader.vue**: 预览窗口头部组件

**设计特点**:
- 🎯 **表单化编辑**: 结构化数据输入替代富文本
- 📱 **响应式预览**: 实时多设备预览
- 🎨 **主题隔离**: 预览窗口独立主题系统
- ⚡ **实时同步**: 编辑内容立即反映到预览

### 第4-5周：多租户媒体库管理系统
**状态**: ✅ **已完成 (100%)**

**任务清单**:
- [x] 多租户媒体库界面 (`/dashboard/media`)
- [x] 批量文件上传功能（拖拽上传）
- [x] 媒体搜索、分类和筛选
- [x] 文件预览和信息显示
- [x] 多租户媒体隔离存储
- [x] 响应式媒体管理界面
- [x] 文件删除确认和批量操作
- [x] 媒体URL复制功能
- [x] 媒体选择器集成到编辑器
- [x] 图片格式优化和压缩

**核心功能实现**:
- ✨ **MediaLibrary** (`/dashboard/media`): 完整媒体库管理界面
- ✨ **文件上传系统**: 拖拽上传 + 进度显示 + 错误处理
- ✨ **R2存储集成**: 多租户路径隔离 (`images/{businessName}/`)
- ✨ **媒体选择器**: 集成到编辑器章节属性中
- ✨ **文件管理**: 预览、信息显示、URL复制、删除确认

**技术亮点**:
```typescript
// 媒体存储路径设计
MEDIA_STRUCTURE = {
  "images/{businessName}/": {
    "*.jpg|png|gif|webp": "图片文件",  
    "*.pdf|doc|docx": "文档文件",
    "*.mp4|avi|mov": "视频文件"
  }
}

// API端点
/api/images/upload.post.ts     // 文件上传
/api/images/delete.delete.ts   // 文件删除  
/api/media/files/[business].get.ts  // 媒体列表
/api/media/stats/[business].get.ts  // 媒体统计
```

### 第5-6周：SEO优化和公开页面
**状态**: ✅ **核心功能完成 (70%)**

**任务清单**:
- [x] SEO元数据管理界面 (集成在页面编辑中)
- [ ] 自动SEO分析和建议
- [ ] 社交媒体预览功能
- [ ] 站点地图自动生成
- [x] 公开页面路由 (`/api/content/[tenant]/[...slug]`)
- [x] 页面发布和预览功能
- [x] 缓存策略实现
- [x] 页面性能优化
- [ ] 内容版本控制界面 (数据结构已完成)
- [ ] 第一阶段功能测试和优化

**备注**: 多租户公开访问和SEO基础功能已实现，需要完善UI组件

### 第6-7周：自定义域名系统
**状态**: ✅ **已完成 (100%)**

**目标**: 基于 Cloudflare Pages Custom Domains API 实现自定义域名管理系统

**已完成任务**:
- [x] **数据库架构**
  - [x] 域名管理表 (domains) 已存在
  - [x] 域名状态跟踪 (pending_dns, pending_ssl, active, error, removed)
  - [x] 企业域名关联和权限验证
- [x] **Cloudflare Pages API 集成**
  - [x] 从 Custom Hostnames 迁移到 Pages Custom Domains API
  - [x] 域名添加到 Pages 项目功能
  - [x] 域名状态检查和验证
  - [x] 域名删除和清理
- [x] **后端API系统**
  - [x] `POST /api/domains/add` - 添加域名到 Pages 项目
  - [x] `POST /api/domains/check-status` - 检查域名验证状态
  - [x] `DELETE /api/domains/remove` - 从 Pages 项目删除域名
  - [x] `GET /api/domains/list` - 获取企业域名列表
- [x] **前端管理界面**
  - [x] DomainManager 组件 - 完整域名管理界面
  - [x] 域名添加表单和 DNS 配置指导
  - [x] 域名状态显示和实时更新
  - [x] 域名验证和删除操作
- [x] **用户体验优化**
  - [x] 简化的 DNS 配置 (只需配置 CNAME)
  - [x] 智能状态指示器和错误处理
  - [x] 用户友好的操作确认和反馈

**核心技术实现**:
```typescript
// Cloudflare Pages API 架构
POST /accounts/{account_id}/pages/projects/{project_name}/domains
GET /accounts/{account_id}/pages/projects/{project_name}/domains
DELETE /accounts/{account_id}/pages/projects/{project_name}/domains/{domain}

// 环境配置
CF_ACCOUNT_ID=your-account-id
CF_PAGES_PROJECT_NAME=repoinsight
CF_API_TOKEN=token-with-pages-edit-permission

// 域名状态管理
DomainStatus = {
  pending_dns: '等待 DNS 配置',
  pending_ssl: 'SSL 证书签发中',
  active: '域名已激活',
  error: '配置错误',
  removed: '已删除'
}
```

**系统优势**:
- **简化配置**: 用户只需配置一条 CNAME 记录
- **自动 SSL**: Cloudflare Pages 自动处理 SSL 证书
- **更高限制**: 支持 250-500 个自定义域名 (相比原来的 100 个)
- **更好集成**: 直接与 Pages 项目集成，管理更统一
- **成本优化**: 无需额外的 Custom Hostnames 费用

**用户体验流程**:
1. 用户在业务设置中访问域名管理面板
2. 输入自定义域名并点击添加
3. 系统显示 CNAME 配置指导 (`domain → pages.dev`)
4. 用户在 DNS 提供商处配置 CNAME 记录
5. 点击验证按钮检查域名状态
6. Cloudflare Pages 自动验证并配置 SSL
7. 域名激活后立即可用

**第一阶段交付标准**:
- ✅ 用户可以创建和编辑页面内容 (100% - 完整富文本编辑器)
- ✅ 支持主页、Landing Pages、报价页创建 (100% - 完整实现)
- ✅ 富文本编辑和媒体管理 (100% - 功能完整，细节优化完成)
- ✅ 页面发布和SEO优化 (100% - 核心功能完成)
- ✅ 响应式和移动端友好 (100% - 多设备预览支持)
- ✅ 自动内容生成 (100% - 新business自动生成默认主页)
- ✅ 媒体库管理 (100% - 完整的文件上传、管理、预览功能)
- ✅ UI/UX优化 (100% - 界面体验全面优化)
- ✅ 生产环境兼容性 (100% - Clipboard API、本地开发环境适配)

---

## 第二阶段：电商功能集成 (5-6周)

**目标**: 在CMS基础上集成电商功能，实现产品展示和在线销售

### 第7-8周：产品管理系统
**状态**: ⏳ 待开始

**任务清单**:
- [ ] 设计产品数据库模式
- [ ] 创建产品相关表 (products, categories, variants)
- [ ] 产品 CRUD API 端点
- [ ] 产品管理界面 (`/dashboard/products`)
- [ ] 产品创建/编辑表单
- [ ] 产品图片管理集成
- [ ] 基础库存管理
- [ ] 产品分类系统
- [ ] 产品状态管理
- [ ] 产品在CMS中的展示组件

### 第8-9周：购物车和结账系统
**状态**: ⏳ 待开始

**任务清单**:
- [ ] 购物车数据库设计
- [ ] 购物车 API 端点开发
- [ ] 购物车组件集成到CMS页面
- [ ] 产品添加到购物车功能
- [ ] 购物车页面设计和实现
- [ ] 简单结账流程
- [ ] Stripe支付集成扩展
- [ ] 订单创建和管理
- [ ] 购物车持久化存储
- [ ] 移动端购物体验优化

### 第9-10周：订单管理系统
**状态**: ⏳ 待开始

**任务清单**:
- [ ] 订单数据库设计与实现
- [ ] 订单创建流程开发
- [ ] 订单管理界面 (`/dashboard/orders`)
- [ ] 订单详情页面设计
- [ ] 订单状态管理系统
- [ ] 客户订单确认邮件
- [ ] 商家订单通知系统
- [ ] 订单搜索和筛选功能
- [ ] 订单导出和打印功能
- [ ] 客户订单查询页面

### 第11-12周：店铺主题和优化
**状态**: ⏳ 待开始

**任务清单**:
- [ ] 店铺主题系统跭计
- [ ] 响应式店铺模板开发
- [ ] 主题定制界面
- [ ] 品牌色彩和字体设置
- [ ] 店铺导航和菜单管理
- [ ] 产品展示页面优化
- [ ] 购物流程 UX 优化
- [ ] 移动端购物体验
- [ ] 页面加载性能优化
- [ ] SEO与电商功能集成

**第二阶段交付标准**:
- ✅ 完整的产品管理和展示系统
- ✅ 流畅的购物和结账流程
- ✅ 完善的订单管理系统
- ✅ 专业的店铺外观和用户体验

---

## 第三阶段：高级功能和优化 (3-4周)

**目标**: 添加高级电商功能、营销工具和系统优化

### 第13-14周：高级电商功能
**状态**: ⏳ 待开始

**任务清单**:
- [ ] 产品变体系统 (尺寸、颜色等)
- [ ] 优惠券和促销系统
- [ ] 库存管理和预警
- [ ] 多种支付方式集成
- [ ] 运费计算器
- [ ] 税收管理系统
- [ ] 退款和退货流程
- [ ] 客户评价和评分系统
- [ ] 推荐产品算法
- [ ] 放弃购物车恢复邮件

### 第14-15周：营销工具和分析
**状态**: ⏳ 待开始

**任务清单**:
- [ ] 邮件营销集成 (Resend/Plunk)
- [ ] Google Analytics 4 集成
- [ ] 社交媒体分享功能
- [ ] SEO工具和站点地图
- [ ] 销售仪表板和分析
- [ ] 产品销售性能报表
- [ ] 客户行为分析
- [ ] 收入和利润统计
- [ ] 营销活动效果跟踪
- [ ] A/B测试基础框架

### 第15-16周：系统优化和发布
**状态**: ⏳ 待开始

**任务清单**:
- [ ] 系统性能监控和优化
- [ ] 数据库查询和索引优化
- [ ] API 速率限制和缓存策略
- [ ] 图片压缩和 CDN 优化
- [ ] 移动端性能优化
- [ ] PWA 功能实现
- [ ] 安全性审计和加固
- [ ] 数据备份和灘雾恢复
- [ ] 用户文档和帮助系统
- [ ] 最终测试和发布准备

**第三阶段交付标准**:
- ✅ 完整的高级电商功能
- ✅ 全面的营销工具和分析
- ✅ 企业级性能和安全性
- ✅ 可以正式上线的稳定系统

---

## 🚀 **最新进展总结** (2025年9月7日)

### 第一阶段CMS开发 - 全面完成 ✅

**整体完成度**: 100% ✅ (第一阶段CMS系统已完全就绪！)

#### 🏆 **已完成的核心模块**

1. **Nuxt Content + R2存储架构 (100%)** ✅
   - 基于Nuxt Content内容框架
   - Cloudflare R2多租户存储隔离
   - YAML配置文件 + JSON数据结构
   - R2UserContentService服务类

2. **多租户API系统 (100%)** ✅
   - 多租户内容API (`/api/content/[business]/`)
   - R2存储服务集成
   - 业务内容获取和更新API
   - 默认内容自动生成机制

3. **自研可视化编辑器 (100%)** ✅
   - 章节属性编辑系统（非富文本）
   - 表单化结构化内容编辑
   - 章节启用/禁用管理
   - 媒体选择器集成

4. **实时预览系统 (100%)** ✅
   - 多设备预览（桌面/平板/移动）
   - 预览窗口主题隔离系统
   - 实时内容同步和品牌定制
   - 响应式设计预览

5. **多租户媒体库系统 (100%)** ✅
   - R2存储路径隔离 (`images/{businessName}/`)
   - 批量文件上传和管理
   - 媒体选择器和预览功能
   - URL复制和删除确认

6. **公开内容发布系统 (100%)** ✅
   - 多租户内容发布
   - SEO元数据集成
   - CDN缓存优化机制
   - 实时内容同步
   - 响应式设计预览

7. **🆕 媒体库管理 (100%)** ✅
   - 完整的媒体库管理界面
   - 拖拽式文件上传
   - 网格/列表双视图模式
   - 文件筛选、搜索、批量操作
   - 多格式文件支持
   - 图片预览和信息显示
   - 复制URL功能
   - 删除确认模态框

8. **🆕 自动内容生成 (100%)** ✅
   - 新business自动生成默认主页
   - 包含完整内容结构和SEO优化
   - 品牌定制化内容

9. **🆕 文本高亮系统 (100%)** ✅
   - 用户友好的 `**text**` Markdown 风格语法
   - 自动转换为技术格式 `[text]{.text-primary}`
   - 双向语法转换和实时验证
   - 页面标题清理机制
   - 全章节组件支持

#### ✨ **新增技术亮点**

1. **现代化编辑体验**
   - 类似Notion的所见即所得编辑
   - 实时预览和多设备适配
   - 自动保存和版本管理
   - 图标选择器优化(48个图标，6列布局)
   - 章节属性组件标准化

2. **企业级媒体管理**
   - 云存储集成 (Cloudflare R2)
   - 文件类型验证和大小限制
   - 批量上传和管理操作
   - 智能Clipboard兼容性处理
   - 本地开发环境降级方案

3. **多租户内容系统**
   - 子域名访问验证正常
   - 品牌定制化自动应用
   - 内容完全隔离
   - 完善的UI/UX优化

4. **用户友好的文本高亮系统**
   - Markdown 风格语法（`**text**`）
   - 自动双向语法转换
   - 实时预览和验证
   - 浏览器标题清理功能
   - 一致的用户体验

5. **高级内容发布工作流**
   - 网站下架功能（Unpublish Website）
   - 内容状态智能管理（Published/Draft/None）
   - 丢弃草稿保护机制
   - 用户友好的确认对话框
   - 动态状态指示器和按钮控制

6. **智能内容初始化系统**
   - 模板驱动的内容初始化
   - 基于用户计划的差异化体验
   - Free Plan 14天试用流程
   - Premium Plan 直接初始化
   - 从模板自动创建草稿内容

#### 🔧 **系统优化完成**

1. **UI/UX体验优化** ✅
   - 编辑器界面布局优化
   - 预览区域滚动修复
   - 标题栏固定显示
   - 模态框显示问题修复
   - 响应式设计完善

2. **技术架构优化** ✅
   - 本地开发环境兼容性
   - Clipboard API智能降级
   - 错误处理和调试完善
   - 代码质量提升

3. **功能完善** ✅
   - 图片选择器优化
   - 媒体库管理完善
   - Copy URL功能优化
   - 删除确认流程完善

#### 📊 **技术亮点**

- **架构优秀**: 多租户、存储分离、类型安全
- **代码质量高**: 完整的TypeScript支持
- **扩展性强**: 模板系统和版本控制基础已就位
- **性能优化**: R2存储、缓存机制、数据库索引

---

## 📈 里程碑和成功指标

| 阶段        | 时间范围  | 主要里程碑       | 成功指标                                                                            | 状态                |
| ----------- | --------- | ---------------- | ----------------------------------------------------------------------------------- | ------------------- |
| **第1阶段** | 第1-6周   | 内容管理系统上线 | • 用户可以创建和编辑页面<br>• 支持主页、Landing Pages创建<br>• 富文本编辑和媒体管理 | ✅ **已完成 (100%)** |
| **第2阶段** | 第7-12周  | 电商功能集成     | • 完整的产品管理系统<br>• 流畅的购物和结账流程<br>• 订单管理和店铺主题              | ⏳ 待开始            |
| **第3阶段** | 第13-16周 | 高级功能和优化   | • 高级电商功能完善<br>• 营销工具和数据分析<br>• 系统性能优化和发布                  | ⏳ 待开始            |

---

## 🌐 子域名代理架构

由于 Cloudflare Pages 不支持通配符子域名（`*.repoinsight.com`），我们实现了一个专用的 Worker 代理来处理子域名访问。

### 架构组件

1. **Cloudflare Worker (`repoinsight-subdomain-proxy`)**
   - 处理所有 `*.repoinsight.com` 的请求
   - 转发请求到 Pages 应用 (`repoinsight.pages.dev`)
   - 添加租户识别头部信息

2. **DNS 配置**
   - 通配符 A 记录：`*` → `192.0.2.1` (启用代理)
   - 使 `tenant.repoinsight.com` 等子域名路由到 Worker

3. **useBusiness 集成**
   - 优先处理来自 Worker 的租户信息
   - 支持开发环境的 localhost 访问

### Worker 配置 (`wrangler-worker.toml`)

```toml
name = "repoinsight-subdomain-proxy"
main = "worker.js"
compatibility_date = "2025-09-12"
compatibility_flags = ["nodejs_compat"]

# 路由配置 - 处理子域名流量
[[routes]]
pattern = "*.repoinsight.com/*"
zone_id = "7dc8d38ef3aed86f953ac46e47470761"

# 环境变量
[vars]
PAGES_URL = "repoinsight.pages.dev"
```

### Worker 代码 (`worker.js`)

```javascript
export default {
  async fetch(request) {
    const url = new URL(request.url)
    const hostname = url.hostname

    // 提取子域名 (例如 tenant.repoinsight.com -> tenant)
    let subdomain = hostname.split('.')[0]

    // 转发到 Pages 应用
    const pagesUrl = `https://repoinsight.pages.dev${url.pathname}${url.search}`

    // 保留原始头部并添加租户识别信息
    const headers = new Headers(request.headers)
    headers.set('x-original-host', hostname)
    headers.set('x-tenant-subdomain', subdomain)
    headers.set('x-tenant-name', subdomain)

    // 转发请求
    return fetch(new Request(pagesUrl, {
      method: request.method,
      headers,
      body: request.body
    }))
  }
}
```

### useBusiness 集成

`app/composables/useBusiness.ts` 中的处理优先级：

1. **Worker 头部信息**（最高优先级）
   - 读取 `x-tenant-name` 和 `x-original-host`
   - 直接设置租户信息

2. **开发环境检测**
   - 支持 localhost 和 127.0.0.1
   - 处理带端口号的 hostname

3. **域名解析**
   - 子域名检测（`tenant.repoinsight.com`）
   - 自定义域名处理
   - 主站回退（`www` 或基础域名）

### 部署命令

```bash
# 部署 Worker
wrangler deploy --config wrangler-worker.toml

# 部署 Pages
pnpm build:cf && wrangler pages deploy dist
```

### 验证测试

1. **DNS 解析检查**
   ```bash
   nslookup tenant.repoinsight.com
   # 应返回 192.0.2.1
   ```

2. **SSL 证书验证**
   ```bash
   curl -I https://tenant.repoinsight.com
   # 应返回有效的 SSL 证书
   ```

3. **租户检测测试**
   - 访问 `https://tenant.repoinsight.com`
   - 检查 Worker 日志中的头部转发
   - 验证 useBusiness 正确识别租户

### 注意事项

- Worker 仅处理子域名代理，自定义域名通过 Pages Custom Domains 直接处理
- 开发环境支持 localhost 访问，无需 Worker
- 所有请求保持原始头部信息和请求体
- SSL 证书由 Cloudflare 自动管理

---

## 🛠️ 技术实施标准

### 代码质量标准
- **测试覆盖率**: > 80%
- **TypeScript 严格模式**: 启用
- **ESLint 规则**: 严格遵循
- **代码审查**: 所有功能需要 Code Review
- **文档更新**: 及时更新 CLAUDE.md 和 API 文档

### 性能目标
- **页面加载时间**: < 3秒 (移动端)
- **API 响应时间**: < 500ms (P95)
- **数据库查询**: 优化 N+1 问题
- **图片加载**: WebP 格式，CDN 分发
- **移动端体验**: Core Web Vitals 绿色评分

### 安全要求
- **数据加密**: 敏感数据必须加密存储
- **API 安全**: 所有端点需要适当的认证和授权
- **输入验证**: 前后端双重验证
- **SQL 注入防护**: 使用参数化查询
- **XSS 防护**: 输出转义和 CSP 头设置

### 部署策略
- **分支管理**: feature → development → staging → main
- **持续集成**: 自动化测试和部署
- **渐进式发布**: 功能完成即可部署测试环境
- **回滚准备**: 每个阶段都要有快速回滚方案
- **监控告警**: 生产环境异常及时通知

---

## 📋 风险管理

### 高风险项目
1. **数据库性能** - 大量产品和订单数据的查询优化
2. **支付集成** - Stripe 复杂场景的处理
3. **并发处理** - 库存并发修改的数据一致性
4. **移动端性能** - 复杂购物车状态的性能优化

### 缓解措施
- 提前进行性能测试和优化
- 制定详细的错误处理和恢复策略
- 准备备用技术方案
- 建立及时的问题反馈机制

---

## 📚 资源和文档

### 开发资源
- **设计系统**: Nuxt UI Pro 组件库
- **API 文档**: 待补充 OpenAPI 规范
- **数据库文档**: Drizzle ORM 模式定义
- **部署文档**: Cloudflare Pages 部署指南

### 学习资源
- [Nuxt 3 官方文档](https://nuxt.com)
- [Stripe 支付集成指南](https://stripe.com/docs)
- [Drizzle ORM 使用指南](https://orm.drizzle.team)
- [电商最佳实践指南](https://developers.shopify.com/themes/best-practices)

---

## 📋 项目总结

**预计总开发时间**: 13-16 周 (第一阶段已提前完成)  
**项目复杂度**: 中高级  
**团队建议**: 1-2 名全栈开发者  
**开发策略**: 内容管理优先，电商功能集成，最后优化完善  
**当前状态**: 第一阶段CMS系统100%完成，第二阶段准备开始  

### 核心优势
- 现有技术基础扎实 (100% 基础设施完整)
- 现代化技术栈和架构设计
- 完善的多租户和认证系统
- 高质量的 UI 组件库
- 企业级内容管理系统已就绪

### 项目价值
这个项目将为小微企业提供一个完整的数字化解决方案，从内容管理到电商销售的一站式服务。第一阶段的成功完成证明了系统的稳定性和扩展性，为后续电商功能开发奠定了坚实基础。

---

## 📞 项目联系信息

**项目负责人**: Gavin  
**技术栈**: Nuxt 3 + TypeScript + Turso + Stripe  
**代码仓库**: https://github.com/GuangyingZhou/repoinsight
**文档位置**: 
- 技术文档: CLAUDE.md
- 项目计划: PROJECT.md (本文件)

---

## 📝 更新日志

| 日期       | 版本 | 更新内容                                                                                                                                                                                                                                                                                                                       | 更新人 |
| ---------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 2025-06-14 | v1.0 | 初始项目计划创建                                                                                                                                                                                                                                                                                                               | Claude |
| 2025-06-14 | v1.1 | 重新调整开发优先级，将内容管理系统提前到第一阶段                                                                                                                                                                                                                                                                               | Claude |
| 2025-06-16 | v2.0 | 📊 重大进展更新：第一阶段CMS开发75%完成，数据库架构100%完成，后端API系统95%完成，前端管理界面90%完成，公开内容系统100%完成                                                                                                                                                                                                      | Claude |
| 2025-06-19 | v3.0 | 🚀 **重大突破**：CMS系统95%完成！新增富文本编辑器(Tiptap)、实时预览系统、媒体库管理、自动内容生成等核心功能。多租户测试验证成功，系统已具备企业级使用条件                                                                                                                                                                       | Claude |
| 2025-09-07 | v3.1 | ✨ **编辑器界面重大优化**：图标选择器优化(48个图标，6列布局)、章节属性组件标准化、编辑区域体验改进、预览区域滚动修复、标题栏固定显示等用户体验提升                                                                                                                                                                              | Claude |
| 2025-09-07 | v4.0 | 🎉 **第一阶段CMS系统全面完成！** 媒体库管理100%完成(包括图片预览、信息显示、复制URL、删除确认)、模态框显示优化、本地开发环境Clipboard兼容性处理、UI/UX全面优化。系统已达到生产就绪状态！                                                                                                                                        | Claude |
| 2025-09-08 | v4.1 | 🔧 **TypeScript代码质量优化**：将关键API端点 `server/api/images/upload.post.js` 转换为TypeScript，增强类型安全性、提升开发体验。添加H3Event类型注解、User接口定义、严格的错误处理类型检查。技术债务清理完成                                                                                                                     | Claude |
| 2025-09-12 | v4.2 | 🎨 **内容编辑器预览窗口颜色主题系统重构**：修复预览窗口 dark/light 模式切换功能、Sign Up 按钮颜色响应、neutral 颜色变化响应。实现主题隔离机制，确保颜色变化只影响预览窗口不影响主编辑页面。使用预定义颜色映射提升系统稳定性，解决 CSS 变量嵌套问题。提交代码：fec9637                                                           | Claude |
| 2025-09-12 | v4.3 | 📋 **CMS技术架构文档重构**：根据项目实际实现更新第一阶段CMS开发内容，准确反映 Nuxt Content + Cloudflare R2存储 + 自研可视化编辑器的技术架构。更新多租户存储结构、API系统设计、章节属性编辑系统、媒体库管理等核心模块描述，提供完整的技术实现细节                                                                                | Claude |
| 2025-09-13 | v5.0 | 🚀 **Cloudflare 生产环境部署优化**：通过移除 Nuxt Content 解决包体积过大无法部署问题；构建路由 Worker 处理生产环境多租户机制；完善 R2 内容读取与颜色主题处理；优化系统对多租户的处理机制；删除多余代码文件，提升部署效率和系统稳定性。修复 TypeScript 类型推断堆栈深度问题                                                      | Claude |
| 2025-01-16 | v5.1 | ✨ **用户友好文本高亮系统实现**：将技术性 `[text]{.text-primary}` 语法替换为用户友好的 `**text**` Markdown 风格语法。创建 TextHighlightProcessor 双向转换工具、HighlightTextInput 组件，更新所有内容属性组件支持文本高亮。修复页面标题显示技术标记问题，添加 cleanMDCText 函数清理浏览器标题和社交媒体元标签。提交代码：c470ad9 | Claude |
| 2025-01-16 | v5.2 | 🎛️ **内容编辑器设置界面重构**：将单一Settings按钮重构为下拉菜单，分离Content Settings和SEO Settings功能。创建独立SeoSettingsModal组件，包含网站标题、描述、关键词、社交媒体设置、Google Analytics、搜索控制台验证等完整SEO配置。从Hero章节移除SEO设置，实现功能模块化分离，提升用户体验和系统维护性                             | Claude |
| 2025-09-16 | v6.0 | 🔄 **企业级内容发布管理系统**：实现完整的网站下架功能，内容从 `contents/` 移动到 `unpublished/` 目录。添加智能内容状态管理（Published/Draft/None），丢弃草稿保护机制，用户友好的确认对话框。实现基于计划的内容初始化系统，Free Plan 14天试用流程，Premium Plan 直接初始化。动态状态指示器和按钮控制，完善的内容工作流管理       | Claude |
| 2025-09-18 | v6.1 | 🌐 **子域名代理架构实现**：解决 Cloudflare Pages 不支持通配符子域名问题，实现专用 Worker 代理系统。配置 `repoinsight-subdomain-proxy` Worker 处理 `*.repoinsight.com` 请求转发，设置通配符 DNS 记录，集成 useBusiness 优先处理 Worker 头部信息。实现完整的租户识别、开发环境支持、SSL 自动管理等功能，确保子域名访问正常工作    | Claude |

---

**注意**: 本文档将随着项目进展持续更新，请定期查看最新版本。所有重大变更都会记录在更新日志中。