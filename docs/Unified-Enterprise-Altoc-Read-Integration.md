# Altoc G1/G2 基础只读接入合同

更新：2026-09-27。合并原 `.git/sol2-altoc-g1-plan.md`、`sol2-altoc-g2-plan.md` 及两组 owning、Runtime 授权、Host 审查报告；页面全量盘点见[Altoc 页面清单](./Unified-Enterprise-Altoc-Pages-Inventory.md)。本合同仅覆盖基础读，不代表 E1/AA-04 履约联动启用。

| 组 | Host 原生列表/详情 | 固定 Runtime 读操作 | 精确 capability / Altoc 人员权限 |
| --- | --- | --- | --- |
| G1 | `/altoc/customers`、`/:customerId` | `altoc.customer-list/view` → `customers:list/view` | `altoc:customer:view` / `customer:view` |
| G1 | `/altoc/contracts`、`/:contractId` | `altoc.contract-list/view` → `contracts:list/view` | `altoc:contract:view` / `contract:view` |
| G1 | `/altoc/payments`、`/:planId` | `altoc.receivable-list/view` → `receivable-plans:list/view` | `altoc:receivable:view` / `receivable:view` |
| G2 | `/altoc/leads`、`/:leadId` | `altoc.lead-list/view` → `leads:list/view` | `altoc:lead:view` / `lead:view` |
| G2 | `/altoc/opportunities`、`/:opportunityId` | `altoc.opportunity-list/view` → `opportunities:list/view` | `altoc:opportunity:view` / `opportunity:view` |
| G2 | `/altoc/quotes`、`/:quotationId` | `altoc.quotation-list/view` → `quotations:list/view` | `altoc:quotation:view` / `quotation:view` |

全部是精确 GET BFF → Foundation 固定操作 → Runtime 精确 POST 读路由；列表/详情分别登记拓扑，错 METHOD 与相邻写路由拒绝。G1/G2 各三条 `enterprise.runtime → data-runtime` qualified grant（`data-runtime:altoc:<resource>/view` 加对应 semanticScope）已由用户批准；实际安装、签发与消费须以环境回执复核，源码 seed 不等于已生效。页面导航取 Altoc manifest 的人员 resource/action，不用服务 capability 替代。

服务端验证 JWKS/issuer、service token、audience/source/client/current credential/grant、tenant/deployment；BFF 从当前 Console 普通快照和 scoped authorization 编译最早到期不超过 14 秒的结构化 permit。actor HMAC 与 permit body 独立 HMAC 复用既有签名合同，绑定 operation、对象 ID、query、scope 和 policy 版本；Runtime 限制 15 秒并对 query 全等校验，先持久 Registry 栅栏再访问业务 SQL。动态 owner/dept/催收关系只从 Altoc 当前行取；COUNT 与页同 WHERE/只读快照，越权对象 404。G2 商机机会筛选与报价 `opportunityId` 纳入独立签名，不与 G1 query 槽串用。

响应只保留基础业务字段。G1 不读 Finance 回款流水、银行资料、扫描件或外部应用富化；G2 不读联系人/活动、成本毛利、审批自由文本或 URL，报价 items 受父报价与数量界限约束。独立 Altoc 管理写入口不嵌入 Host 只读页；缺管理 URL 时隐藏入口。G1 owning `19c18382`、Runtime 授权 `4a0fdfeb`、Host `8c4f530b`；G2 owning `61732cf8`、Runtime 授权 `08fb973d`、Host `ee9e69d5`。授权反例包含缺 cap、错 aud/source、撤销、body 篡改、跨 tenant/deployment、动态范围变化和 Registry 故障；隔离测试不替代真实登录/跨租户验收。本机 Altoc 域已激活，十二页岗位验收仍以环境记录和试点脚本逐项签收。
