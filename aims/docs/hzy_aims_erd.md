# hzy_aims 实体关系图

> 汇智云 Aims 项目管理模块 | 三层驱动架构: 里程碑(目标层) → 需求(价值层) → 任务(执行层)

```mermaid
erDiagram
    project_portfolios ||--o{ aims_projects : contains
    project_portfolios ||--o{ project_documents : has
    aims_projects ||--o{ aims_project_members : has
    aims_projects ||--o{ aims_project_repos : links
    aims_projects ||--|| project_counters : has
    aims_projects ||--o{ workflow_transitions : defines
    aims_projects ||--o{ milestones : contains
    aims_projects ||--o{ work_items : contains
    aims_projects ||--o{ gitlab_commits : tracks
    aims_projects ||--o{ notification_rules : configures
    aims_projects ||--o{ user_favorite_projects : favorited
    aims_projects ||--o{ project_documents : has
    aims_projects ||--o{ deliverables : has
    aims_projects ||--o{ approval_records : has

    milestones ||--o{ work_items : contains
    milestones ||--o{ project_documents : has

    work_items ||--o{ work_items : nests
    work_items ||--o{ work_item_relations : source
    work_items ||--o{ work_item_relations : target
    work_items ||--o{ work_item_comments : has
    work_items ||--o{ work_item_changelog : logs
    work_items ||--o{ work_item_attachments : attaches
    work_items ||--o{ time_entries : records
    work_items ||--o{ gitlab_commits : references
    work_items ||--o{ project_documents : has

    project_documents ||--o{ project_documents : nests

    project_portfolios {
        bigint id PK
        varchar code UK
        varchar name
        text description
        varchar domain_code
        varchar owner_uid
        varchar dept_code
        tinyint is_product_line
        int display_order
        enum status
        varchar created_by
    }

    aims_projects {
        bigint id PK
        varchar project_code UK
        varchar name
        varchar short_name
        varchar internal_code
        text description
        enum category
        enum methodology
        enum lifecycle_status
        bigint portfolio_id FK
        varchar domain_code
        varchar dept_code
        varchar leader_uid
        date start_date
        date end_date
        varchar customer_code
        varchar customer_name
        enum approval_status
        json module_config
        json board_config
        json workflow_config
        varchar created_by
    }

    aims_project_members {
        bigint id PK
        bigint project_id FK
        varchar uid
        enum role
        enum status
        datetime joined_at
    }

    aims_project_repos {
        bigint id PK
        bigint project_id FK
        varchar repo_project_code
        varchar last_commit_sha
        datetime last_synced_at
    }

    project_counters {
        bigint id PK
        bigint project_id FK
        int counter
    }

    workflow_transitions {
        bigint id PK
        bigint project_id FK
        enum entity_type
        varchar from_status
        varchar to_status
        varchar transition_key
        tinyint is_initial
    }

    milestones {
        bigint id PK
        bigint project_id FK
        varchar name
        text description
        enum mode
        date start_date
        date end_date
        enum status
        enum pivr_stage
        varchar recurrence_rule
        int sort_order
    }

    work_items {
        bigint id PK
        bigint project_id FK
        bigint milestone_id FK
        int item_number
        varchar item_key UK
        enum tier
        enum type
        varchar title
        longtext description
        varchar status
        enum priority
        enum severity
        smallint weight
        varchar assignee_uid
        varchar reporter_uid
        date due_date
        decimal estimated_hours
        bigint parent_id FK
        int sort_order
    }

    work_item_relations {
        bigint id PK
        bigint source_id FK
        bigint target_id FK
        enum relation_type
    }

    work_item_comments {
        bigint id PK
        bigint work_item_id FK
        varchar author_uid
        longtext content
    }

    work_item_changelog {
        bigint id PK
        bigint work_item_id FK
        varchar field_name
        text old_value
        text new_value
        varchar changed_by
        datetime changed_at
    }

    work_item_attachments {
        bigint id PK
        bigint work_item_id FK
        varchar file_name
        varchar oss_key
        bigint file_size
        varchar content_type
        varchar uploaded_by
    }

    project_documents {
        bigint id PK
        char uuid UK
        bigint portfolio_id FK
        bigint project_id FK
        varchar project_code
        bigint milestone_id FK
        bigint work_item_id FK
        bigint parent_id FK
        varchar title
        varchar doc_category
        tinyint is_folder
        varchar oss_path
        char codocs_uuid
        int content_size
        int sort_order
        varchar created_by
        varchar updated_by
    }

    deliverables {
        bigint id PK
        bigint project_owner_id FK
        bigint milestone_owner_id FK
        bigint work_item_owner_id FK
        varchar name
        text description
        text acceptance_criteria
        enum deliverable_type
        tinyint required
        int sort_order
        enum status
        char document_uuid
        varchar evidence_url
        text evidence_note
        varchar submitted_by
        datetime submitted_at
        bigint project_id FK
        varchar project_code
        varchar created_by
    }

    approval_records {
        bigint id PK
        bigint project_owner_id FK
        bigint milestone_owner_id FK
        bigint work_item_owner_id FK
        varchar entity_code
        varchar transition
        varchar title
        varchar requested_by
        datetime requested_at
        text request_comment
        varchar reviewer_uid
        enum status
        datetime reviewed_at
        text review_comment
        varchar workflow_instance_id
        bigint project_id FK
        varchar project_code
    }

    time_entries {
        bigint id PK
        bigint work_item_id FK
        varchar uid
        date entry_date
        decimal hours
        varchar description
    }

    gitlab_commits {
        bigint id PK
        bigint project_id FK
        bigint work_item_id FK
        varchar item_key
        varchar repo_project_code
        char commit_sha
        text message
        varchar author_name
        datetime committed_at
    }

    notification_rules {
        bigint id PK
        bigint project_id FK
        varchar event_type
        tinyint enabled
        json config
    }

    user_favorite_projects {
        bigint id PK
        varchar uid
        bigint project_id FK
    }

    system_parameters {
        bigint id PK
        varchar param_key UK
        text param_value
        varchar description
    }
```

## 表说明

| # | 表名 | 说明 | 核心关系 |
|---|------|------|---------|
| 1 | project_portfolios | 项目集(项目组合管理) | → aims_projects (1:N), → project_documents (1:N) |
| 2 | aims_projects | 项目主表 | 核心实体，所有表围绕它展开 |
| 3 | aims_project_members | 项目成员 | → aims_projects (N:1) |
| 4 | aims_project_repos | 项目-仓库关联(N:M) | → aims_projects (N:1), 关联 Account git_projects |
| 5 | project_counters | 工作项编号计数器 | → aims_projects (1:1) |
| 6 | workflow_transitions | 状态流转规则 | → aims_projects (N:1), NULL=系统默认 |
| 7 | milestones | 里程碑(目标层) | → aims_projects (N:1), → work_items (1:N), → project_documents (1:N) |
| 8 | work_items | 统一工作项(需求/任务/缺陷) | → milestones (N:1必填), 自引用 parent_id, tier: target/matter |
| 9 | work_item_relations | 工作项关联(阻塞/关联) | → work_items (N:1) x 2 |
| 10 | work_item_comments | 工作项评论 | → work_items (N:1) |
| 11 | work_item_changelog | 工作项变更日志 | → work_items (N:1) |
| 12 | work_item_attachments | 工作项附件(OSS) | → work_items (N:1) |
| 13 | ~~work_item_documents~~ | ~~工作项-Codocs文档关联~~ (已废弃, 合并到 project_documents) | ~~→ work_items (N:1)~~ |
| 14 | project_documents | 项目文档(统一管理各层级) | → project_portfolios/aims_projects/milestones/work_items (N:1), 自引用 parent_id |
| 15 | deliverables | 交付物/验收项 | 显式 owner 外键(project/milestone/work_item 三选一), → aims_projects (N:1 根项目) |
| 16 | approval_records | 统一审核记录 | 显式 owner 外键(project/milestone/work_item 三选一), → aims_projects (N:1 根项目) |
| 17 | time_entries | 工时记录 | → work_items (N:1) |
| 18 | gitlab_commits | GitLab提交关联 | → aims_projects (N:1), → work_items (N:1) |
| 19 | notification_rules | 通知规则 | → aims_projects (N:1) |
| 20 | user_favorite_projects | 用户收藏项目 | → aims_projects (N:1) |
| 21 | system_parameters | 系统参数 | 独立表 |

## 三层驱动架构

```
项目集 (project_portfolios)
  └── 项目 (aims_projects)
        ├── 里程碑 - 目标层 (milestones) ← PIVR: P/I/V/R
        │     ├── 工作项 (work_items) ← milestone_id 必填
        │     │     ├── 目标 (tier=target) - 价值层
        │     │     │     └── 事项 (tier=matter) - 执行层 ← parent_id 嵌套
        │     │     ├── 需求 (type=requirement) / 任务 (type=task) / 缺陷 (type=bug)
        │     │     └── 附件 (work_item_attachments) / 评论 / 变更日志 / 工时
        │     └── 交付物 (deliverables) ← 验收标准 + 审核闭环
        ├── 文档 (project_documents) ← 统一管理, 支持文件夹嵌套, 关联Codocs
        ├── 审核记录 (approval_records) ← 立项/里程碑完成/目标确认等
        ├── 成员 (aims_project_members)
        ├── 仓库关联 (aims_project_repos) → Account git_projects
        ├── 代码提交 (gitlab_commits)
        └── 通知规则 (notification_rules)
```
