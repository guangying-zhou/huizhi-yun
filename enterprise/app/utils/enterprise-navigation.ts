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
                "permission": {
                  "resource": "timesheet",
                  "action": "view"
                }
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
            "id": "documents.space",
            "code": "space",
            "label": "文档空间",
            "icon": "i-lucide-folder-open",
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
                "label": "文件柜",
                "to": "/codocs/mydocs/cabinet",
                "module": "codocs",
                "permission": {
                  "resource": "documents",
                  "action": "view"
                }
              },
              {
                "id": "codocs.documents.space.favorites",
                "label": "收藏",
                "to": "/codocs/mydocs/favorites",
                "module": "codocs",
                "permission": {
                  "resource": "documents",
                  "action": "view"
                }
              },
              {
                "id": "codocs.documents.space.recently",
                "label": "最近使用",
                "to": "/codocs/mydocs/recently",
                "module": "codocs",
                "permission": {
                  "resource": "documents",
                  "action": "view"
                }
              },
              {
                "id": "codocs.documents.space.recycle",
                "label": "回收站",
                "to": "/codocs/mydocs/recycle",
                "module": "codocs",
                "permission": {
                  "resource": "documents",
                  "action": "view"
                }
              }
            ]
          },
          {
            "id": "documents.review",
            "code": "review",
            "label": "文档协作",
            "icon": "i-lucide-message-square-text",
            "children": [
              {
                "id": "codocs.documents.review.shared",
                "label": "协同文档",
                "to": "/codocs/mydocs/shared",
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
        "id": "console",
        "code": "console",
        "label": "控制台",
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
                "id": "assets.console.config.dictionaries",
                "label": "资产字典",
                "to": "/assets/admin/dictionaries",
                "module": "assets",
                "permission": {
                  "resource": "admin",
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
          "label": "概览",
          "items": [
            {
              "id": "aims.project.overview",
              "label": "项目概览",
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
              "path": "/plan",
              "module": "aims",
              "permission": {
                "resource": "work_items",
                "action": "view"
              }
            },
            {
              "id": "aims.project.board",
              "label": "任务看板",
              "path": "/board",
              "module": "aims",
              "permission": {
                "resource": "work_items",
                "action": "view"
              }
            },
            {
              "id": "aims.project.metrics",
              "label": "度量分析",
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
              "path": "/risks",
              "module": "aims",
              "permission": {
                "resource": "projects",
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
              "id": "aims.project.requirements",
              "label": "需求",
              "path": "/requirements",
              "module": "aims",
              "permission": {
                "resource": "requirements",
                "action": "view"
              }
            },
            {
              "id": "aims.project.documents",
              "label": "项目文档",
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
              "id": "aims.project.edit",
              "label": "项目设置",
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
      "path": "/assets/products/:id",
      "name": "assets-product-detail"
    },
    {
      "path": "/assets/admin/asset-categories",
      "name": "assets-product-category-admin"
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
      "path": "/assets/digital-assets/:id",
      "name": "assets-digital-asset-detail"
    },
    {
      "path": "/assets/ip-assets",
      "name": "assets-ip-assets"
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
    }
  ]
} as const
