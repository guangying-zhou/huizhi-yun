// Generated from the composition registry; do not edit by hand.
export const enterpriseNavigation = {
  "businessNavigation": {
    "primary": [
      {
        "id": "workspace",
        "code": "workspace",
        "label": "工作台",
        "icon": "i-lucide-layout-dashboard",
        "children": [
          {
            "id": "workspace.self",
            "code": "self",
            "label": "我的工作",
            "icon": "i-lucide-user",
            "children": [
              {
                "id": "console.workspace.notifications",
                "label": "通知",
                "to": "/enterprise/notifications",
                "module": "console",
                "access": {
                  "kind": "authenticated-self"
                }
              },
              {
                "id": "console.workspace.todos",
                "label": "我的待办",
                "to": "/enterprise/todos",
                "module": "console",
                "access": {
                  "kind": "authenticated-self"
                }
              },
              {
                "id": "codocs.workspace.self.journal",
                "label": "工作汇报",
                "to": "/codocs/mydocs/journal",
                "module": "codocs",
                "permission": {
                  "resource": "documents",
                  "action": "view"
                }
              }
            ]
          }
        ]
      },
      {
        "id": "product",
        "code": "product",
        "label": "产品",
        "icon": "i-lucide-package",
        "children": [
          {
            "id": "product.catalog",
            "code": "catalog",
            "label": "产品目录",
            "icon": "i-lucide-book-marked",
            "children": [
              {
                "id": "assets.product.catalog.products",
                "label": "全部产品",
                "to": "/assets/products",
                "module": "assets",
                "permission": {
                  "resource": "products",
                  "action": "view"
                }
              }
            ]
          },
          {
            "id": "product.planning",
            "code": "planning",
            "label": "产品规划",
            "icon": "i-lucide-map",
            "children": [
              {
                "id": "aims.product.planning.products",
                "label": "产品管理空间",
                "to": "/aims/products",
                "module": "aims",
                "permission": {
                  "resource": "products",
                  "action": "view"
                }
              }
            ]
          },
          {
            "id": "product.assets",
            "code": "assets",
            "label": "产品资产",
            "icon": "i-lucide-box",
            "children": [
              {
                "id": "assets.product.assets.ip",
                "label": "知识产权",
                "to": "/assets/ip-assets",
                "module": "assets",
                "permission": {
                  "resource": "ip_assets",
                  "action": "view"
                }
              },
              {
                "id": "assets.product.assets.digital",
                "label": "数字资产",
                "to": "/assets/digital-assets",
                "module": "assets",
                "permission": {
                  "resource": "digital_assets",
                  "action": "view"
                }
              }
            ]
          }
        ]
      },
      {
        "id": "sales",
        "code": "sales",
        "label": "销售",
        "icon": "i-lucide-handshake",
        "children": [
          {
            "id": "sales.customer",
            "code": "customer",
            "label": "客户经营",
            "icon": "i-lucide-building-2",
            "children": [
              {
                "id": "altoc.sales.customers",
                "label": "客户",
                "to": "/altoc/customers",
                "module": "altoc",
                "permission": {
                  "resource": "customer",
                  "action": "view"
                }
              }
            ]
          },
          {
            "id": "sales.opportunity",
            "code": "opportunity",
            "label": "销售机会",
            "icon": "i-lucide-target",
            "children": [
              {
                "id": "altoc.sales.leads",
                "label": "线索",
                "to": "/altoc/leads",
                "module": "altoc",
                "permission": {
                  "resource": "lead",
                  "action": "view"
                }
              },
              {
                "id": "altoc.sales.opportunities",
                "label": "商机",
                "to": "/altoc/opportunities",
                "module": "altoc",
                "permission": {
                  "resource": "opportunity",
                  "action": "view"
                }
              }
            ]
          },
          {
            "id": "sales.quote",
            "code": "quote",
            "label": "报价与投标",
            "icon": "i-lucide-file-text",
            "children": [
              {
                "id": "altoc.sales.quotes",
                "label": "报价",
                "to": "/altoc/quotes",
                "module": "altoc",
                "permission": {
                  "resource": "quotation",
                  "action": "view"
                }
              }
            ]
          },
          {
            "id": "sales.contract",
            "code": "contract",
            "label": "合同管理",
            "icon": "i-lucide-file-signature",
            "children": [
              {
                "id": "altoc.sales.contracts",
                "label": "合同",
                "to": "/altoc/contracts",
                "module": "altoc",
                "permission": {
                  "resource": "contract",
                  "action": "view"
                }
              }
            ]
          },
          {
            "id": "sales.settlement",
            "code": "settlement",
            "label": "结算与回款",
            "icon": "i-lucide-wallet",
            "children": [
              {
                "id": "altoc.sales.payments",
                "label": "回款计划",
                "to": "/altoc/payments",
                "module": "altoc",
                "permission": {
                  "resource": "receivable",
                  "action": "view"
                }
              }
            ]
          }
        ]
      },
      {
        "id": "delivery",
        "code": "delivery",
        "label": "交付与服务",
        "icon": "i-lucide-truck",
        "children": [
          {
            "id": "delivery.project",
            "code": "project",
            "label": "项目管理",
            "icon": "i-lucide-folder-kanban",
            "children": [
              {
                "id": "aims.delivery.project.projects",
                "label": "项目总览",
                "to": "/aims/projects",
                "module": "aims",
                "permission": {
                  "resource": "projects",
                  "action": "view"
                }
              }
            ]
          },
          {
            "id": "delivery.execution",
            "code": "execution",
            "label": "执行协同",
            "icon": "i-lucide-list-checks",
            "children": [
              {
                "id": "aims.delivery.execution.work-items",
                "label": "任务中心",
                "to": "/aims/work-items",
                "module": "aims",
                "permission": {
                  "resource": "work_items",
                  "action": "view"
                }
              },
              {
                "id": "aims.delivery.execution.timesheet",
                "label": "工时日历",
                "to": "/aims/timesheet",
                "module": "aims",
                "permissionRefs": [
                  {
                    "resource": "timesheet",
                    "action": "view"
                  },
                  {
                    "resource": "timesheet",
                    "action": "submit"
                  }
                ],
                "mode": "any"
              },
              {
                "id": "aims.delivery.execution.weekly-reports",
                "label": "周报汇总",
                "to": "/aims/weekly-reports",
                "module": "aims",
                "permission": {
                  "resource": "weekly_reports",
                  "action": "view"
                }
              }
            ]
          }
        ]
      },
      {
        "id": "operations",
        "code": "operations",
        "label": "经营",
        "icon": "i-lucide-chart-line",
        "children": [
          {
            "id": "operations.resource",
            "code": "resource",
            "label": "企业资源",
            "icon": "i-lucide-boxes",
            "children": [
              {
                "id": "assets.operations.resource.physical",
                "label": "自用资产",
                "to": "/assets/physical",
                "module": "assets",
                "permission": {
                  "resource": "asset_items",
                  "action": "view"
                }
              },
              {
                "id": "assets.operations.resource.resources",
                "label": "资源台账",
                "to": "/assets/resources",
                "module": "assets",
                "permission": {
                  "resource": "asset_items",
                  "action": "view"
                }
              }
            ]
          }
        ]
      }
    ],
    "auxiliary": [
      {
        "id": "documents",
        "code": "documents",
        "label": "文档",
        "icon": "i-lucide-files",
        "children": [
          {
            "id": "documents.personal",
            "code": "personal",
            "label": "我的空间",
            "icon": "i-lucide-user",
            "children": [
              {
                "id": "codocs.documents.space.mydocs",
                "label": "我的文档",
                "to": "/codocs/mydocs",
                "module": "codocs",
                "permission": {
                  "resource": "documents",
                  "action": "view"
                }
              },
              {
                "id": "codocs.documents.space.cabinet",
                "label": "我的文件柜",
                "to": "/codocs/mydocs/cabinet",
                "module": "codocs",
                "permission": {
                  "resource": "documents",
                  "action": "view"
                }
              }
            ]
          },
          {
            "id": "documents.department",
            "code": "department",
            "label": "部门空间",
            "icon": "i-lucide-building",
            "children": [
              {
                "id": "codocs.documents.space.department-documents",
                "label": "部门文档",
                "to": "/codocs/departments",
                "module": "codocs",
                "permission": {
                  "resource": "departments",
                  "action": "view"
                }
              },
              {
                "id": "codocs.documents.space.department-cabinet",
                "label": "部门文件柜",
                "to": "/codocs/departments/cabinet",
                "module": "codocs",
                "permission": {
                  "resource": "departments",
                  "action": "view"
                }
              },
              {
                "id": "codocs.documents.space.department-records",
                "label": "会议记录",
                "to": "/codocs/departments/records",
                "module": "codocs",
                "permission": {
                  "resource": "departments",
                  "action": "view"
                }
              },
              {
                "id": "codocs.documents.space.department-rules",
                "label": "部门规章",
                "to": "/codocs/departments/rules",
                "module": "codocs",
                "permission": {
                  "resource": "departments",
                  "action": "view"
                }
              },
              {
                "id": "codocs.documents.space.department-outsides",
                "label": "对外发文",
                "to": "/codocs/departments/outsides",
                "module": "codocs",
                "permission": {
                  "resource": "departments",
                  "action": "view"
                }
              }
            ]
          },
          {
            "id": "documents.project",
            "code": "project",
            "label": "项目空间",
            "icon": "i-lucide-folder-kanban",
            "children": [
              {
                "id": "aims.documents.space.project-documents",
                "label": "项目文档",
                "to": "/aims/project-documents",
                "module": "aims",
                "permission": {
                  "resource": "projects",
                  "action": "view"
                }
              }
            ]
          },
          {
            "id": "documents.company",
            "code": "company",
            "label": "公司空间",
            "icon": "i-lucide-building-2",
            "children": [
              {
                "id": "codocs.documents.company.rules",
                "label": "公司制度",
                "to": "/codocs/company/rules",
                "module": "codocs",
                "permission": {
                  "resource": "company",
                  "action": "view"
                }
              },
              {
                "id": "codocs.documents.company.notice",
                "label": "通知公告",
                "to": "/codocs/company/notice",
                "module": "codocs",
                "permission": {
                  "resource": "company",
                  "action": "view"
                }
              },
              {
                "id": "codocs.documents.company.legal",
                "label": "法务合规",
                "to": "/codocs/company/legal",
                "module": "codocs",
                "permission": {
                  "resource": "company",
                  "action": "view"
                }
              },
              {
                "id": "codocs.documents.company.culture",
                "label": "企业文化",
                "to": "/codocs/company/culture",
                "module": "codocs",
                "permission": {
                  "resource": "company",
                  "action": "view"
                }
              },
              {
                "id": "codocs.documents.company.tech-specs",
                "label": "技术规范",
                "to": "/codocs/company/tech-specs",
                "module": "codocs",
                "permission": {
                  "resource": "company",
                  "action": "view"
                }
              },
              {
                "id": "codocs.documents.company.knowledge",
                "label": "公司知识库",
                "to": "/codocs/company/knowledge",
                "module": "codocs",
                "permission": {
                  "resource": "company",
                  "action": "view"
                }
              },
              {
                "id": "codocs.documents.review.open-department-docs",
                "label": "各部门开放文档",
                "to": "/codocs/company/open-department-docs",
                "module": "codocs",
                "permission": {
                  "resource": "company",
                  "action": "view"
                }
              }
            ]
          }
        ]
      },
      {
        "id": "console",
        "code": "console",
        "label": "设置",
        "icon": "i-lucide-settings",
        "children": [
          {
            "id": "console.config",
            "code": "config",
            "label": "业务配置",
            "icon": "i-lucide-sliders-horizontal",
            "children": [
              {
                "id": "assets.console.config.categories",
                "label": "产品字典",
                "to": "/assets/admin/asset-categories",
                "module": "assets",
                "permission": {
                  "resource": "admin",
                  "action": "view"
                }
              },
              {
                "id": "aims.console.config.admin-projects",
                "label": "项目管理（管理员）",
                "to": "/aims/admin/projects",
                "module": "aims",
                "permission": {
                  "resource": "admin",
                  "action": "admin"
                }
              },
              {
                "id": "aims.console.config.weekly-reporting-settings",
                "label": "周报设置",
                "to": "/aims/admin/weekly-reporting-settings",
                "module": "aims",
                "permission": {
                  "resource": "weekly_reports",
                  "action": "configure"
                }
              },
              {
                "id": "assets.console.config.dictionaries",
                "label": "资产字典",
                "to": "/assets/admin/dictionaries",
                "module": "assets",
                "permission": {
                  "resource": "admin",
                  "action": "view"
                }
              },
              {
                "id": "codocs.documents.template.company",
                "label": "文档模板",
                "to": "/codocs/company/templates",
                "module": "codocs",
                "permission": {
                  "resource": "company",
                  "action": "view"
                }
              }
            ]
          }
        ]
      }
    ]
  },
  "objectWorkspaces": [
    {
      "code": "aims-project",
      "label": "项目",
      "base": "/aims/projects/:id",
      "backTo": "/aims/projects",
      "backLabel": "返回项目总览",
      "actions": [
        {
          "id": "aims.project.create-work-item",
          "module": "aims",
          "permission": {
            "resource": "work_items",
            "action": "create"
          }
        }
      ],
      "groups": [
        {
          "id": "aims-project.overview",
          "label": "",
          "items": [
            {
              "id": "aims.project.overview",
              "label": "项目概览",
              "icon": "i-lucide-layout-dashboard",
              "path": "",
              "module": "aims",
              "permission": {
                "resource": "projects",
                "action": "view"
              }
            }
          ]
        },
        {
          "id": "aims-project.plan-execution",
          "label": "计划与执行",
          "items": [
            {
              "id": "aims.project.plan",
              "label": "里程碑",
              "icon": "i-lucide-flag",
              "path": "/plan",
              "module": "aims",
              "permission": {
                "resource": "work_items",
                "action": "view"
              }
            },
            {
              "id": "aims.project.requirements",
              "label": "需求",
              "icon": "i-lucide-clipboard-list",
              "path": "/requirements",
              "module": "aims",
              "permission": {
                "resource": "requirements",
                "action": "view"
              }
            },
            {
              "id": "aims.project.goals",
              "label": "项目目标",
              "icon": "i-lucide-target",
              "path": "/work-items",
              "module": "aims",
              "permission": {
                "resource": "work_items",
                "action": "view"
              }
            },
            {
              "id": "aims.project.board",
              "label": "任务看板",
              "icon": "i-lucide-list-checks",
              "path": "/board",
              "module": "aims",
              "permission": {
                "resource": "work_items",
                "action": "view"
              }
            }
          ]
        },
        {
          "id": "aims-project.delivery-quality",
          "label": "交付与质量",
          "items": [
            {
              "id": "aims.project.documents",
              "label": "项目文档",
              "icon": "i-lucide-files",
              "path": "/documents",
              "module": "aims",
              "permission": {
                "resource": "projects",
                "action": "view"
              }
            },
            {
              "id": "aims.project.output",
              "label": "项目产出",
              "icon": "i-lucide-award",
              "path": "/output",
              "module": "aims",
              "permission": {
                "resource": "projects",
                "action": "view"
              }
            },
            {
              "id": "aims.project.releases",
              "label": "项目版本",
              "icon": "i-lucide-git-branch",
              "path": "/releases",
              "module": "aims",
              "permission": {
                "resource": "projects",
                "action": "view"
              }
            }
          ]
        },
        {
          "id": "aims-project.team-investment",
          "label": "团队与投入",
          "items": [
            {
              "id": "aims.project.members",
              "label": "项目成员",
              "icon": "i-lucide-users",
              "path": "/members",
              "module": "aims",
              "permission": {
                "resource": "projects",
                "action": "view"
              }
            },
            {
              "id": "aims.project.timesheet",
              "label": "工时",
              "icon": "i-lucide-clock",
              "path": "/timesheet",
              "module": "aims",
              "permission": {
                "resource": "timesheet",
                "action": "view"
              }
            },
            {
              "id": "aims.project.weekly-reports",
              "label": "周报",
              "icon": "i-lucide-calendar-days",
              "path": "/weekly-reports",
              "module": "aims",
              "permission": {
                "resource": "weekly_reports",
                "action": "view"
              }
            }
          ]
        },
        {
          "id": "aims-project.project-management",
          "label": "项目管理",
          "items": [
            {
              "id": "aims.project.metrics",
              "label": "度量分析",
              "icon": "i-lucide-bar-chart-3",
              "path": "/metrics",
              "module": "aims",
              "permission": {
                "resource": "projects",
                "action": "view"
              }
            },
            {
              "id": "aims.project.risks",
              "label": "风险管控",
              "icon": "i-lucide-shield-alert",
              "path": "/risks",
              "module": "aims",
              "permission": {
                "resource": "projects",
                "action": "view"
              }
            },
            {
              "id": "aims.project.edit",
              "label": "项目设置",
              "icon": "i-lucide-settings",
              "path": "/edit",
              "module": "aims",
              "permission": {
                "resource": "projects",
                "action": "edit"
              }
            }
          ]
        }
      ]
    }
  ],
  "registeredPages": [
    {
      "path": "/aims",
      "name": "aims-index"
    },
    {
      "path": "/aims/products",
      "name": "aims-products-shell"
    },
    {
      "path": "/aims/products",
      "name": "aims-products"
    },
    {
      "path": "/aims/products/:productCode",
      "name": "aims-product-workspace"
    },
    {
      "path": "/aims/products/:productCode",
      "name": "aims-product-overview"
    },
    {
      "path": "/aims/products/:productCode/structure",
      "name": "aims-product-structure"
    },
    {
      "path": "/aims/products/:productCode/features",
      "name": "aims-product-features-legacy"
    },
    {
      "path": "/aims/products/:productCode/components",
      "name": "aims-product-components-legacy"
    },
    {
      "path": "/aims/products/:productCode/adoption",
      "name": "aims-product-adoption"
    },
    {
      "path": "/aims/products/:productCode/documents",
      "name": "aims-product-documents"
    },
    {
      "path": "/aims/products/:productCode/cycles",
      "name": "aims-product-cycles"
    },
    {
      "path": "/aims/products/:productCode/features/:featureId",
      "name": "aims-product-feature-index"
    },
    {
      "path": "/aims/products/:productCode/features/:featureId/requests",
      "name": "aims-product-feature-requests"
    },
    {
      "path": "/aims/products/:productCode/features/:featureId/lifecycle",
      "name": "aims-product-feature-lifecycle"
    },
    {
      "path": "/aims/products/:productCode/features/:featureId/roadmap",
      "name": "aims-product-feature-roadmap"
    },
    {
      "path": "/aims/products/:productCode/requests",
      "name": "aims-product-requests"
    },
    {
      "path": "/aims/products/:productCode/planning-items/:itemId/handoff",
      "name": "aims-product-handoff"
    },
    {
      "path": "/aims/products/:productCode/execution-coordination",
      "name": "aims-product-execution-coordination"
    },
    {
      "path": "/aims/products/:productCode/planning",
      "name": "aims-product-planning"
    },
    {
      "path": "/aims/products/:productCode/versions",
      "name": "aims-product-versions"
    },
    {
      "path": "/aims/products/:productCode/versions/:versionId",
      "name": "aims-product-version"
    },
    {
      "path": "/aims/products/:productCode/versions/:versionId",
      "name": "aims-product-version-overview"
    },
    {
      "path": "/aims/products/:productCode/versions/:versionId/acceptance",
      "name": "aims-product-version-acceptance"
    },
    {
      "path": "/aims/products/:productCode/versions/:versionId/acceptances",
      "name": "aims-product-version-acceptances"
    },
    {
      "path": "/aims/products/:productCode/versions/:versionId/acceptances/:acceptanceId",
      "name": "aims-product-version-acceptances-detail"
    },
    {
      "path": "/aims/products/:productCode/versions/:versionId/releases",
      "name": "aims-product-version-releases"
    },
    {
      "path": "/aims/products/:productCode/versions/:versionId/releases/:recordId",
      "name": "aims-product-version-releases-detail"
    },
    {
      "path": "/aims/products/:productCode/versions/:versionId/plan",
      "name": "aims-product-version-plan"
    },
    {
      "path": "/aims/products/:productCode/versions/:versionId/features",
      "name": "aims-product-version-features"
    },
    {
      "path": "/aims/projects",
      "name": "aims-projects"
    },
    {
      "path": "/aims/project-documents",
      "name": "aims-project-document-overview"
    },
    {
      "path": "/aims/admin/projects",
      "name": "aims-admin-projects"
    },
    {
      "path": "/aims/admin/weekly-reporting-settings",
      "name": "aims-admin-weekly-reporting-settings"
    },
    {
      "path": "/aims/projects/new",
      "name": "aims-project-new"
    },
    {
      "path": "/aims/projects/:id",
      "name": "aims-project-detail"
    },
    {
      "path": "/aims/projects/:id/edit",
      "name": "aims-project-edit"
    },
    {
      "path": "/aims/projects/:projectId/work-items/new",
      "name": "aims-work-item-new"
    },
    {
      "path": "/aims/work-items/:id/edit",
      "name": "aims-work-item-edit"
    },
    {
      "path": "/aims/work-items/:id/association",
      "name": "aims-work-item-association"
    },
    {
      "path": "/aims/projects/:id/timesheet",
      "name": "aims-project-timesheet"
    },
    {
      "path": "/aims/projects/:id/timesheet/:entryId",
      "name": "aims-project-time-entry-detail"
    },
    {
      "path": "/aims/projects/:id/weekly-reports",
      "name": "aims-project-weekly-reports"
    },
    {
      "path": "/aims/projects/:id/weekly-reports/:periodKey",
      "name": "aims-project-weekly-report-detail"
    },
    {
      "path": "/aims/projects/:id/members",
      "name": "aims-project-members"
    },
    {
      "path": "/aims/projects/:id/documents",
      "name": "aims-project-documents"
    },
    {
      "path": "/aims/projects/:id/documents/:documentId",
      "name": "aims-project-document-detail"
    },
    {
      "path": "/aims/projects/:id/documents/:documentId/open",
      "name": "aims-project-document-open"
    },
    {
      "path": "/aims/projects/:id/requirements",
      "name": "aims-project-requirements"
    },
    {
      "path": "/aims/projects/:id/requirements/:requirementId",
      "name": "aims-project-requirement-detail"
    },
    {
      "path": "/aims/projects/:id/metrics",
      "name": "aims-project-metrics"
    },
    {
      "path": "/aims/projects/:id/risks",
      "name": "aims-project-risks"
    },
    {
      "path": "/aims/projects/:id/output",
      "name": "aims-project-output"
    },
    {
      "path": "/aims/projects/:id/output/:deliverableId",
      "name": "aims-project-output-detail"
    },
    {
      "path": "/aims/projects/:id/releases",
      "name": "aims-project-releases"
    },
    {
      "path": "/aims/projects/:id/releases/:releaseId",
      "name": "aims-project-release-detail"
    },
    {
      "path": "/aims/projects/:id/plan",
      "name": "aims-project-plan"
    },
    {
      "path": "/aims/projects/:id/board",
      "name": "aims-project-board"
    },
    {
      "path": "/aims/projects/:id/board/:workItemId/execution",
      "name": "aims-project-board-execution"
    },
    {
      "path": "/aims/timesheet",
      "name": "aims-timesheet"
    },
    {
      "path": "/aims/weekly-reports",
      "name": "aims-weekly-reports"
    },
    {
      "path": "/aims/projects/:id/work-items",
      "name": "aims-project-work-items"
    },
    {
      "path": "/aims/projects/:id/work-items/:workItemId/append",
      "name": "aims-project-work-item-append"
    },
    {
      "path": "/aims/projects/:id/work-items/:workItemId/breakdown",
      "name": "aims-project-work-item-breakdown"
    },
    {
      "path": "/aims/projects/:id/work-items/:workItemId/decompose",
      "name": "aims-project-work-item-decompose"
    },
    {
      "path": "/aims/work-items",
      "name": "aims-work-items"
    },
    {
      "path": "/aims/work-items/:id",
      "name": "aims-work-item-detail"
    },
    {
      "path": "/assets",
      "name": "assets-index"
    },
    {
      "path": "/assets/products",
      "name": "assets-products"
    },
    {
      "path": "/assets/products/new",
      "name": "assets-product-create"
    },
    {
      "path": "/assets/products/:id/edit",
      "name": "assets-product-edit"
    },
    {
      "path": "/assets/products/:id",
      "name": "assets-product-detail"
    },
    {
      "path": "/assets/admin/asset-categories",
      "name": "assets-product-category-admin"
    },
    {
      "path": "/assets/admin/asset-categories/new",
      "name": "assets-product-category-create"
    },
    {
      "path": "/assets/admin/asset-categories/:id/edit",
      "name": "assets-product-category-edit"
    },
    {
      "path": "/assets/admin/dictionaries",
      "name": "assets-dictionaries"
    },
    {
      "path": "/assets/physical",
      "name": "assets-physical-assets"
    },
    {
      "path": "/assets/resources",
      "name": "assets-resource-assets"
    },
    {
      "path": "/assets/digital-assets",
      "name": "assets-digital-assets"
    },
    {
      "path": "/assets/digital-assets/new",
      "name": "assets-digital-assets-create"
    },
    {
      "path": "/assets/digital-assets/:id/edit",
      "name": "assets-digital-assets-edit"
    },
    {
      "path": "/assets/digital-assets/:id",
      "name": "assets-digital-asset-detail"
    },
    {
      "path": "/assets/ip-assets",
      "name": "assets-ip-assets"
    },
    {
      "path": "/assets/ip-assets/new",
      "name": "assets-ip-assets-create"
    },
    {
      "path": "/assets/ip-assets/:id/edit",
      "name": "assets-ip-assets-edit"
    },
    {
      "path": "/assets/ip-assets/:id",
      "name": "assets-ip-asset-detail"
    },
    {
      "path": "/assets/items/:id",
      "name": "assets-asset-detail"
    },
    {
      "path": "/codocs",
      "name": "codocs-index"
    },
    {
      "path": "/codocs/mydocs",
      "name": "codocs-mydocs"
    },
    {
      "path": "/codocs/mydocs/cabinet",
      "name": "codocs-mydocs-cabinet"
    },
    {
      "path": "/codocs/mydocs/favorites",
      "name": "codocs-mydocs-favorites"
    },
    {
      "path": "/codocs/mydocs/recently",
      "name": "codocs-mydocs-recently"
    },
    {
      "path": "/codocs/mydocs/recycle",
      "name": "codocs-mydocs-recycle"
    },
    {
      "path": "/codocs/mydocs/shared",
      "name": "codocs-mydocs-shared"
    },
    {
      "path": "/codocs/mydocs/journal",
      "name": "codocs-mydocs-journal"
    },
    {
      "path": "/codocs/mydocs/worklogs",
      "name": "codocs-mydocs-worklogs"
    },
    {
      "path": "/codocs/mydocs/weekly-reports",
      "name": "codocs-mydocs-weekly-reports"
    },
    {
      "path": "/codocs/documents/:uuid",
      "name": "codocs-document-editor"
    },
    {
      "path": "/codocs/departments",
      "name": "codocs-department-documents"
    },
    {
      "path": "/codocs/departments/records",
      "name": "codocs-department-records"
    },
    {
      "path": "/codocs/departments/cabinet",
      "name": "codocs-department-cabinet"
    },
    {
      "path": "/codocs/departments/outsides",
      "name": "codocs-department-outsides"
    },
    {
      "path": "/codocs/departments/rules",
      "name": "codocs-department-rules"
    },
    {
      "path": "/codocs/company/rules",
      "name": "codocs-company-rules"
    },
    {
      "path": "/codocs/company/notice",
      "name": "codocs-company-notice"
    },
    {
      "path": "/codocs/company/legal",
      "name": "codocs-company-legal"
    },
    {
      "path": "/codocs/company/culture",
      "name": "codocs-company-culture"
    },
    {
      "path": "/codocs/company/tech-specs",
      "name": "codocs-company-tech-specs"
    },
    {
      "path": "/codocs/company/knowledge",
      "name": "codocs-company-knowledge"
    },
    {
      "path": "/codocs/company/templates",
      "name": "codocs-company-templates"
    },
    {
      "path": "/codocs/company/open-department-docs",
      "name": "codocs-company-open-department-docs"
    },
    {
      "path": "/codocs/company/document",
      "name": "codocs-company-document"
    },
    {
      "path": "/codocs/departments/document",
      "name": "codocs-department-document"
    },
    {
      "path": "/codocs/s/:token",
      "name": "codocs-published-asset-short-link"
    },
    {
      "path": "/enterprise/notifications",
      "name": "console-host-notifications"
    },
    {
      "path": "/enterprise/notifications/:notificationId",
      "name": "console-host-notifications-notificationId"
    },
    {
      "path": "/enterprise/todos",
      "name": "console-host-todos"
    },
    {
      "path": "/altoc/customers",
      "name": "altoc-host-customers"
    },
    {
      "path": "/altoc/customers/:customerId",
      "name": "altoc-host-customers-detail"
    },
    {
      "path": "/altoc/contracts",
      "name": "altoc-host-contracts"
    },
    {
      "path": "/altoc/contracts/:contractId",
      "name": "altoc-host-contracts-detail"
    },
    {
      "path": "/altoc/payments",
      "name": "altoc-host-payments"
    },
    {
      "path": "/altoc/payments/:planId",
      "name": "altoc-host-payments-detail"
    },
    {
      "path": "/altoc/leads",
      "name": "altoc-host-leads"
    },
    {
      "path": "/altoc/leads/:leadId",
      "name": "altoc-host-leads-detail"
    },
    {
      "path": "/altoc/opportunities",
      "name": "altoc-host-opportunities"
    },
    {
      "path": "/altoc/opportunities/:opportunityId",
      "name": "altoc-host-opportunities-detail"
    },
    {
      "path": "/altoc/quotes",
      "name": "altoc-host-quotes"
    },
    {
      "path": "/altoc/quotes/:quotationId",
      "name": "altoc-host-quotes-detail"
    }
  ],
  "navigationSources": [
    {
      "appCode": "aims",
      "manifestHash": "685a785cc888b4cf6526d112b19ce9c9fae5b24763cda6195ca4c1d4dc79111b"
    },
    {
      "appCode": "assets",
      "manifestHash": "cb47c707f93b1583d72775343da02c9ad2e75c55a095e21dcc55419d1d399696"
    },
    {
      "appCode": "codocs",
      "manifestHash": "1fc99b40accddd545b1cb011344ff095bc9477bd6398f44ccfe7e77160f462ce"
    },
    {
      "appCode": "console",
      "manifestHash": "4cf6147513b9fac71903bdf9a96395f8b831e23968b111e9a31412ff54d09e36"
    },
    {
      "appCode": "altoc",
      "manifestHash": "e48e1629c53ea11eb0d144eb883c2a7b6fe8bb287f0b99ff7e19e543903b4000"
    }
  ]
} as const
