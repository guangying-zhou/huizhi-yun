# 项目总览与候选分页（P6a）

Host 沿用 GET `/aims/api/v1/projects`，固定 `aims.project-list`、Runtime POST `/v1/enterprise/aims/projects:list`、capability `aims:projects:view`。没有新增网关路径或 grant。浏览器不能指定 actor、scope 或 canManagePortfolios。

## 查询与兼容

- page 从1开始且≤1000000，pageSize≤100；重复、空值、小数、超限拒绝。无分页参数/无 projection 的 owning 项目列表原响应字段与默认查询不变；显式分页 COUNT/items 共用 read-only Repeatable Read。
- projection=projects：`{items,total,page,pageSize,summary}`，现有项目筛选、可见性、当前成员/负责人事实与当前 Console projects:view 结构化 permit 全部在 COUNT/page 之前。
- projection=portfolios：分页根为 `{portfolio,canDelete}`；保留原 active 项目集根与空组，非空组在空组前，routine 仍最后，稳定 displayOrder/id；组内项目独立分页。未分组项目是独立桶，不算项目集根 total。
- projection=candidates：个人工时项目候选，当前负责人 OR 当前 active manager/member 成员在 COUNT/page 前判断；搜索独立分页。
- projection=switcher：项目切换候选，配 participating_only=1；favoritesOnly=1 在 SQL 按可信 current_user 的收藏表筛选。排序常用优先、name/id，不再对有限页作搜索或常用过滤。
- summary 的 projectCount、portfolioCounts、statusCounts、yearCounts 是相同完整筛选与权限集合；yearCounts 是项目 start_date 的自然年（空值为0）。latestByLine 以 portfolioId:serviceLineCode 分组，historicalCounts 沿原 maintenance/最大服务期序号/服务期标签规则，用于完整历史分类计数，均与当前页无关。内部扫描授权集合的轻量元数据后聚合，不返回完整项目行。

Host GET `/aims/api/v1/portfolios` 保留平铺根响应，改复用同一 scoped project read operation；只读操作不再返回范围外项目数。独立 Aims 无参数 portfolio list 的旧合同不变。

## 删除资格

projectCount 是当前 projects:view 下的可见数。canDelete 单独由服务端依据当前 portfolios:admin、非系统项目集与完整未归档项目不存在计算；只返回布尔，无完整计数。无管理权为 false；管理者有隐藏子项目也为 false；真实 DELETE 仍检查管理权限及完整 COUNT，无分页/可见性豁免。

## Host 与限制

总览根和每组20条独立 UPagination，显示完整『共N条』；URL groupPage 保留根页。年度判定/计数来自完整投影，不从当前子页推导。工时候选、项目切换及更换所属项目集选择器均提供独立搜索、分页与失败重试；工时已选项目在翻页后保留以免失去当前目标。身份/范围变化及401/403清空私有页和编辑上下文，迟到根/子页响应不能补回旧页。单次读取 COUNT/page/summary 一致；独立根与各子页请求不承诺跨 HTTP 调用的同一快照。canDelete 是展示事实，写入仍以 DELETE 时的完整检查为准。

MVP 完整汇总内部工作量随可见项目数增长；每个根页最多20个项目集与一个独立桶，每组返回≤100行。浏览器登录、1440/390与部署后验收由协调者安排，本批不部署或改环境。
