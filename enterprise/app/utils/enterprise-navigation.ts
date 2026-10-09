// Generated from the composition registry; do not edit by hand.
export const enterpriseNavigation = {
  businessNavigation: {
    primary: [
      {
        id: 'workspace',
        code: 'workspace',
        label: '工作台',
        icon: 'i-lucide-layout-dashboard',
        heading: false,
        children: [
          {
            id: 'workspace.home',
            code: 'home',
            label: '工作台',
            icon: 'i-lucide-layout-dashboard',
            children: [
              {
                id: 'console.workspace.home',
                label: '工作台',
                to: '/enterprise',
                module: 'console',
                access: {
                  kind: 'authenticated-self'
                }
              }
            ]
          },
          {
            id: 'workspace.todos',
            code: 'todos',
            label: '我的待办',
            icon: 'i-lucide-list-todo',
            children: [
              {
                id: 'console.workspace.todos',
                label: '我的待办',
                to: '/enterprise/todos',
                module: 'console',
                access: {
                  kind: 'authenticated-self'
                }
              }
            ]
          },
          {
            id: 'workspace.reports',
            code: 'reports',
            label: '工作汇报',
            icon: 'i-lucide-notebook-pen',
            children: [
              {
                id: 'codocs.workspace.self.journal',
                label: '工作汇报',
                to: '/codocs/mydocs/journal',
                module: 'codocs',
                permission: {
                  resource: 'documents',
                  action: 'view'
                }
              }
            ]
          }
        ]
      },
      {
        id: 'product',
        code: 'product',
        label: '产品',
        icon: 'i-lucide-package',
        children: [
          {
            id: 'product.catalog',
            code: 'catalog',
            label: '产品目录',
            icon: 'i-lucide-book-marked',
            children: [
              {
                id: 'assets.product.catalog.products',
                label: '全部产品',
                to: '/assets/products',
                module: 'assets',
                permission: {
                  resource: 'products',
                  action: 'view'
                }
              }
            ]
          },
          {
            id: 'product.planning',
            code: 'planning',
            label: '产品规划',
            icon: 'i-lucide-map',
            children: [
              {
                id: 'aims.product.planning.products',
                label: '产品管理空间',
                to: '/aims/products',
                module: 'aims',
                permission: {
                  resource: 'products',
                  action: 'view'
                }
              }
            ]
          },
          {
            id: 'product.assets',
            code: 'assets',
            label: '产品资产',
            icon: 'i-lucide-box',
            children: [
              {
                id: 'assets.product.assets.ip',
                label: '知识产权',
                to: '/assets/ip-assets',
                module: 'assets',
                permission: {
                  resource: 'ip_assets',
                  action: 'view'
                }
              },
              {
                id: 'assets.product.assets.digital',
                label: '数字资产',
                to: '/assets/digital-assets',
                module: 'assets',
                permission: {
                  resource: 'digital_assets',
                  action: 'view'
                }
              }
            ]
          }
        ]
      },
      {
        id: 'sales',
        code: 'sales',
        label: '销售',
        icon: 'i-lucide-handshake',
        children: [
          {
            id: 'sales.customer',
            code: 'customer',
            label: '客户经营',
            icon: 'i-lucide-building-2',
            children: [
              {
                id: 'altoc.sales.customers',
                label: '客户',
                to: '/altoc/customers',
                module: 'altoc',
                permission: {
                  resource: 'customer',
                  action: 'view'
                }
              },
              {
                id: 'altoc.sales.migration',
                label: '迁移事项',
                to: '/altoc/migration',
                module: 'altoc',
                permission: {
                  resource: 'migration_exceptions',
                  action: 'view'
                }
              }
            ]
          },
          {
            id: 'sales.opportunity',
            code: 'opportunity',
            label: '销售机会',
            icon: 'i-lucide-target',
            children: [
              {
                id: 'altoc.sales.leads',
                label: '线索',
                to: '/altoc/leads',
                module: 'altoc',
                permission: {
                  resource: 'lead',
                  action: 'view'
                }
              },
              {
                id: 'altoc.sales.opportunities',
                label: '商机',
                to: '/altoc/opportunities',
                module: 'altoc',
                permission: {
                  resource: 'opportunity',
                  action: 'view'
                }
              },
              {
                id: 'altoc.sales.tenders',
                label: '投标',
                to: '/altoc/tenders',
                module: 'altoc',
                permission: {
                  resource: 'opportunity',
                  action: 'view'
                }
              }
            ]
          },
          {
            id: 'sales.quote',
            code: 'quote',
            label: '报价与投标',
            icon: 'i-lucide-file-text',
            children: [
              {
                id: 'altoc.sales.quotes',
                label: '报价',
                to: '/altoc/quotes',
                module: 'altoc',
                permission: {
                  resource: 'quotation',
                  action: 'view'
                }
              }
            ]
          },
          {
            id: 'sales.contract',
            code: 'contract',
            label: '合同管理',
            icon: 'i-lucide-file-signature',
            children: [
              {
                id: 'altoc.sales.contracts',
                label: '合同',
                to: '/altoc/contracts',
                module: 'altoc',
                permission: {
                  resource: 'contract',
                  action: 'view'
                }
              }
            ]
          },
          {
            id: 'sales.settlement',
            code: 'settlement',
            label: '结算与回款',
            icon: 'i-lucide-wallet',
            children: [
              {
                id: 'altoc.sales.payments',
                label: '收款与结算',
                to: '/altoc/payments',
                module: 'altoc',
                permission: {
                  resource: 'receivable',
                  action: 'view'
                }
              }
            ]
          }
        ]
      },
      {
        id: 'delivery',
        code: 'delivery',
        label: '项目',
        icon: 'i-lucide-truck',
        children: [
          {
            id: 'delivery.project',
            code: 'project',
            label: '项目总览',
            icon: 'i-lucide-folder-kanban',
            children: [
              {
                id: 'aims.delivery.project.projects',
                label: '项目总览',
                to: '/aims/projects',
                module: 'aims',
                permission: {
                  resource: 'projects',
                  action: 'view'
                }
              }
            ]
          },
          {
            id: 'delivery.documents',
            code: 'documents',
            label: '项目文档',
            icon: 'i-lucide-files',
            children: [
              {
                id: 'aims.documents.space.project-documents',
                label: '项目文档',
                to: '/aims/project-documents',
                module: 'aims',
                permission: {
                  resource: 'projects',
                  action: 'view'
                }
              }
            ]
          },
          {
            id: 'delivery.management',
            code: 'management',
            label: '项目管理',
            icon: 'i-lucide-settings',
            children: [
              {
                id: 'aims.console.config.admin-projects',
                label: '项目管理',
                to: '/aims/admin/projects',
                module: 'aims',
                permission: {
                  resource: 'admin',
                  action: 'admin'
                }
              }
            ]
          },
          {
            id: 'delivery.execution',
            code: 'execution',
            label: '执行协同',
            icon: 'i-lucide-list-checks',
            children: [
              {
                id: 'aims.delivery.execution.work-items',
                label: '任务中心',
                to: '/aims/work-items',
                module: 'aims',
                permission: {
                  resource: 'work_items',
                  action: 'view'
                }
              },
              {
                id: 'aims.delivery.execution.timesheet',
                label: '工时日历',
                to: '/aims/timesheet',
                module: 'aims',
                permissionRefs: [
                  {
                    resource: 'timesheet',
                    action: 'view'
                  },
                  {
                    resource: 'timesheet',
                    action: 'submit'
                  }
                ],
                mode: 'any'
              },
              {
                id: 'aims.delivery.execution.weekly-reports',
                label: '周报汇总',
                to: '/aims/weekly-reports',
                module: 'aims',
                permission: {
                  resource: 'weekly_reports',
                  action: 'view'
                }
              }
            ]
          },
          {
            id: 'delivery.service',
            code: 'service',
            label: '维护服务',
            icon: 'i-lucide-wrench',
            children: [
              {
                id: 'altoc.service.agreements',
                label: '服务协议',
                to: '/altoc/service-agreements',
                module: 'altoc',
                permission: {
                  resource: 'contract',
                  action: 'view'
                }
              },
              {
                id: 'altoc.service.tickets',
                label: '服务工单',
                to: '/altoc/service-tickets',
                module: 'altoc',
                permission: {
                  resource: 'service_ticket',
                  action: 'view'
                }
              },
              {
                id: 'altoc.service.renewals',
                label: '续约记录',
                to: '/altoc/renewals',
                module: 'altoc',
                permission: {
                  resource: 'renewal_opportunity',
                  action: 'view'
                }
              }
            ]
          }
        ]
      },
      {
        id: 'operations',
        code: 'operations',
        label: '经营',
        icon: 'i-lucide-chart-line',
        children: [
          {
            id: 'operations.treasury',
            code: 'treasury',
            label: '账户与资金',
            icon: 'i-lucide-landmark',
            children: [
              {
                id: 'finance.operations.treasury.accounts',
                label: '银行账户',
                to: '/finance/bank-accounts',
                module: 'finance',
                permission: {
                  resource: 'bank_accounts',
                  action: 'view'
                }
              },
              {
                id: 'finance.operations.treasury.legal-entities',
                label: '法人主体',
                to: '/finance/legal-entities',
                module: 'finance',
                permission: {
                  resource: 'legal_entities',
                  action: 'view'
                }
              },
              {
                id: 'finance.operations.treasury.snapshots',
                label: '余额快照',
                to: '/finance/bank-accounts/balances',
                module: 'finance',
                permission: {
                  resource: 'bank_accounts',
                  action: 'view'
                }
              },
              {
                id: 'finance.operations.treasury.invoice-requests',
                label: '开票申请',
                to: '/finance/invoices/requests',
                module: 'finance',
                permission: {
                  resource: 'invoices',
                  action: 'view'
                }
              },
              {
                id: 'finance.operations.treasury.invoices',
                label: '正式发票',
                to: '/finance/invoices',
                module: 'finance',
                permission: {
                  resource: 'invoices',
                  action: 'view'
                }
              },
              {
                id: 'finance.operations.treasury.receipts',
                label: '收款与结算',
                to: '/finance/receipts',
                module: 'finance',
                permission: {
                  resource: 'receipts',
                  action: 'view'
                }
              },
              {
                id: 'finance.operations.treasury.reconciliation',
                label: '核销',
                to: '/finance/reconciliation',
                module: 'finance',
                permission: {
                  resource: 'reconciliation',
                  action: 'view'
                }
              },
              {
                id: 'finance.operations.treasury.historical-finance',
                label: '历史财务接续',
                to: '/finance/historical-finance',
                module: 'finance',
                permission: {
                  resource: 'historical_finance',
                  action: 'view'
                }
              },
              {
                id: 'finance.operations.treasury.receivable-adjustments',
                label: '应收调整',
                to: '/finance/receivable-adjustments',
                module: 'finance',
                permission: {
                  resource: 'receivable_adjustments',
                  action: 'view'
                }
              },
              {
                id: 'finance.operations.treasury.allocation-batches',
                label: '分配批次',
                to: '/finance/allocation-batches',
                module: 'finance',
                permission: {
                  resource: 'reconciliation',
                  action: 'view'
                }
              },
              {
                id: 'finance.operations.treasury.expenses',
                label: '支出台账',
                to: '/finance/expenses',
                module: 'finance',
                permission: {
                  resource: 'expenses',
                  action: 'view'
                }
              },
              {
                id: 'finance.operations.treasury.claims',
                label: '费用报销',
                to: '/finance/expenses/claims',
                module: 'finance',
                permission: {
                  resource: 'expenses',
                  action: 'view'
                }
              },
              {
                id: 'finance.operations.treasury.project-requests',
                label: '项目支出申请',
                to: '/finance/expenses/project-requests',
                module: 'finance',
                permission: {
                  resource: 'expenses',
                  action: 'view'
                }
              },
              {
                id: 'finance.operations.treasury.payment-requests',
                label: '付款申请',
                to: '/finance/payment-requests',
                module: 'finance',
                permission: {
                  resource: 'expenses',
                  action: 'view'
                }
              },
              {
                id: 'finance.operations.treasury.project-accounting',
                label: '项目核算',
                to: '/finance/project-accounting',
                module: 'finance',
                permission: {
                  resource: 'project_accounting',
                  action: 'view'
                }
              },
              {
                id: 'finance.operations.treasury.cost-allocations',
                label: '成本分摊',
                to: '/finance/project-cost-allocations',
                module: 'finance',
                permission: {
                  resource: 'project_accounting',
                  action: 'view'
                }
              },
              {
                id: 'finance.operations.treasury.employee-costs',
                label: '员工月成本',
                to: '/finance/employee-costs',
                module: 'finance',
                permission: {
                  resource: 'project_accounting',
                  action: 'admin'
                }
              },
              {
                id: 'finance.operations.treasury.migration',
                label: '迁移事项',
                to: '/finance/migration',
                module: 'finance',
                permission: {
                  resource: 'migration_exceptions',
                  action: 'view'
                }
              }
            ]
          },
          {
            id: 'operations.resource',
            code: 'resource',
            label: '企业资源',
            icon: 'i-lucide-boxes',
            children: [
              {
                id: 'assets.operations.resource.physical',
                label: '自用资产',
                to: '/assets/physical',
                module: 'assets',
                permission: {
                  resource: 'asset_items',
                  action: 'view'
                }
              },
              {
                id: 'assets.operations.resource.resources',
                label: '资源台账',
                to: '/assets/resources',
                module: 'assets',
                permission: {
                  resource: 'asset_items',
                  action: 'view'
                }
              }
            ]
          }
        ]
      },
      {
        id: 'people',
        code: 'people',
        label: '人力资源',
        icon: 'i-lucide-users',
        children: [
          {
            id: 'people.org',
            code: 'org',
            label: '组织与岗位',
            icon: 'i-lucide-network',
            children: [
              {
                id: 'people.position.list',
                label: '岗位',
                to: '/people/settings/positions',
                module: 'people',
                permission: {
                  resource: 'positions',
                  action: 'view'
                }
              },
              {
                id: 'people.rank.list',
                label: '职级',
                to: '/people/settings/ranks',
                module: 'people',
                permission: {
                  resource: 'ranks',
                  action: 'view'
                }
              },
              {
                id: 'people.hr-source',
                label: '人事事实源',
                to: '/people/settings/hr-source-sync',
                module: 'people',
                permission: {
                  resource: 'hr_source_sync',
                  action: 'view'
                }
              }
            ]
          },
          {
            id: 'people.employee',
            code: 'employee',
            label: '员工管理',
            icon: 'i-lucide-user-round',
            children: [
              {
                id: 'people.employee.list',
                label: '员工',
                to: '/people/employees',
                module: 'people',
                permission: {
                  resource: 'employees',
                  action: 'view'
                }
              },
              {
                id: 'people.assignment.list',
                label: '任职',
                to: '/people/assignments',
                module: 'people',
                permission: {
                  resource: 'assignments',
                  action: 'view'
                }
              },
              {
                id: 'people.onboarding.list',
                label: '入职候选',
                to: '/people/onboarding',
                module: 'people',
                permission: {
                  resource: 'employees',
                  action: 'view'
                }
              },
              {
                id: 'people.offboarding.list',
                label: '离职事项',
                to: '/people/offboarding',
                module: 'people',
                permission: {
                  resource: 'offboarding_tasks',
                  action: 'view'
                }
              },
              {
                id: 'people.directory-recovery',
                label: '目录投递与恢复',
                to: '/people/directory-recovery',
                module: 'people',
                permission: {
                  resource: 'integration_operations',
                  action: 'view'
                }
              }
            ]
          },
          {
            id: 'people.cost',
            code: 'cost',
            label: '人员成本',
            icon: 'i-lucide-coins',
            children: [
              {
                id: 'people.standard-cost.list',
                label: '职级工资设置',
                to: '/people/settings/standard-costs',
                module: 'people',
                permission: {
                  resource: 'standard_costs',
                  action: 'view'
                }
              }
            ]
          }
        ]
      }
    ],
    auxiliary: [
      {
        id: 'documents',
        code: 'documents',
        label: '文档',
        icon: 'i-lucide-files',
        children: [
          {
            id: 'documents.personal',
            code: 'personal',
            label: '我的空间',
            icon: 'i-lucide-user',
            children: [
              {
                id: 'codocs.documents.space.mydocs',
                label: '我的文档',
                to: '/codocs/mydocs',
                module: 'codocs',
                permission: {
                  resource: 'documents',
                  action: 'view'
                }
              },
              {
                id: 'codocs.documents.space.cabinet',
                label: '我的文件柜',
                to: '/codocs/mydocs/cabinet',
                module: 'codocs',
                permission: {
                  resource: 'documents',
                  action: 'view'
                }
              }
            ]
          },
          {
            id: 'documents.department',
            code: 'department',
            label: '部门空间',
            icon: 'i-lucide-building',
            children: [
              {
                id: 'codocs.documents.space.department-documents',
                label: '部门文档',
                to: '/codocs/departments',
                module: 'codocs',
                permission: {
                  resource: 'departments',
                  action: 'view'
                }
              },
              {
                id: 'codocs.documents.space.department-cabinet',
                label: '部门文件柜',
                to: '/codocs/departments/cabinet',
                module: 'codocs',
                permission: {
                  resource: 'departments',
                  action: 'view'
                }
              },
              {
                id: 'codocs.documents.space.department-records',
                label: '会议记录',
                to: '/codocs/departments/records',
                module: 'codocs',
                permission: {
                  resource: 'departments',
                  action: 'view'
                }
              },
              {
                id: 'codocs.documents.space.department-rules',
                label: '部门规章',
                to: '/codocs/departments/rules',
                module: 'codocs',
                permission: {
                  resource: 'departments',
                  action: 'view'
                }
              },
              {
                id: 'codocs.documents.space.department-outsides',
                label: '对外发文',
                to: '/codocs/departments/outsides',
                module: 'codocs',
                permission: {
                  resource: 'departments',
                  action: 'view'
                }
              }
            ]
          },
          {
            id: 'documents.company',
            code: 'company',
            label: '公司空间',
            icon: 'i-lucide-building-2',
            children: [
              {
                id: 'codocs.documents.company.rules',
                label: '公司制度',
                to: '/codocs/company/rules',
                module: 'codocs',
                permission: {
                  resource: 'company',
                  action: 'view'
                }
              },
              {
                id: 'codocs.documents.company.notice',
                label: '通知公告',
                to: '/codocs/company/notice',
                module: 'codocs',
                permission: {
                  resource: 'company',
                  action: 'view'
                }
              },
              {
                id: 'codocs.documents.company.legal',
                label: '法务合规',
                to: '/codocs/company/legal',
                module: 'codocs',
                permission: {
                  resource: 'company',
                  action: 'view'
                }
              },
              {
                id: 'codocs.documents.company.culture',
                label: '企业文化',
                to: '/codocs/company/culture',
                module: 'codocs',
                permission: {
                  resource: 'company',
                  action: 'view'
                }
              },
              {
                id: 'codocs.documents.company.tech-specs',
                label: '技术规范',
                to: '/codocs/company/tech-specs',
                module: 'codocs',
                permission: {
                  resource: 'company',
                  action: 'view'
                }
              },
              {
                id: 'codocs.documents.company.knowledge',
                label: '公司知识库',
                to: '/codocs/company/knowledge',
                module: 'codocs',
                permission: {
                  resource: 'company',
                  action: 'view'
                }
              },
              {
                id: 'codocs.documents.review.open-department-docs',
                label: '各部门开放文档',
                to: '/codocs/company/open-department-docs',
                module: 'codocs',
                permission: {
                  resource: 'company',
                  action: 'view'
                }
              }
            ]
          }
        ]
      },
      {
        id: 'console',
        code: 'console',
        label: '设置',
        icon: 'i-lucide-settings',
        children: [
          {
            id: 'console.config',
            code: 'config',
            label: '业务配置',
            icon: 'i-lucide-sliders-horizontal',
            children: [
              {
                id: 'assets.console.config.categories',
                label: '产品字典',
                to: '/assets/admin/asset-categories',
                module: 'assets',
                permission: {
                  resource: 'admin',
                  action: 'view'
                }
              },
              {
                id: 'aims.console.config.weekly-reporting-settings',
                label: '周报设置',
                to: '/aims/admin/weekly-reporting-settings',
                module: 'aims',
                permission: {
                  resource: 'weekly_reports',
                  action: 'configure'
                }
              },
              {
                id: 'assets.console.config.dictionaries',
                label: '资产字典',
                to: '/assets/admin/dictionaries',
                module: 'assets',
                permission: {
                  resource: 'admin',
                  action: 'view'
                }
              },
              {
                id: 'codocs.documents.template.company',
                label: '文档模板',
                to: '/codocs/company/templates',
                module: 'codocs',
                permission: {
                  resource: 'company',
                  action: 'view'
                }
              },
              {
                id: 'finance.console.config.people-cost',
                label: '人力成本参数',
                to: '/finance/settings/people-cost-parameters',
                module: 'finance',
                permission: {
                  resource: 'settings',
                  action: 'admin'
                }
              },
              {
                id: 'finance.console.config.expense-types',
                label: '费用类型',
                to: '/finance/settings/expense-types',
                module: 'finance',
                permission: {
                  resource: 'settings',
                  action: 'admin'
                }
              },
              {
                id: 'finance.console.config.income-types',
                label: '收入类型',
                to: '/finance/settings/income-types',
                module: 'finance',
                permission: {
                  resource: 'settings',
                  action: 'admin'
                }
              },
              {
                id: 'finance.console.config.subjects',
                label: '财务科目',
                to: '/finance/settings/subjects',
                module: 'finance',
                permission: {
                  resource: 'settings',
                  action: 'admin'
                }
              },
              {
                id: 'finance.console.config.subject-mappings',
                label: '科目映射',
                to: '/finance/settings/subject-mappings',
                module: 'finance',
                permission: {
                  resource: 'settings',
                  action: 'admin'
                }
              },
              {
                id: 'finance.console.config.accounting-objects',
                label: '核算对象',
                to: '/finance/accounting-objects',
                module: 'finance',
                permission: {
                  resource: 'settings',
                  action: 'admin'
                }
              },
              {
                id: 'finance.console.config.audit-logs',
                label: '财务审计',
                to: '/finance/audit-logs',
                module: 'finance',
                permission: {
                  resource: 'settings',
                  action: 'admin'
                }
              },
              {
                id: 'finance.console.config.approval-instances',
                label: '审批关联',
                to: '/finance/integrations/approval-instances',
                module: 'finance',
                permission: {
                  resource: 'settings',
                  action: 'admin'
                }
              }
            ]
          }
        ]
      }
    ]
  },
  objectWorkspaces: [
    {
      code: 'aims-project',
      label: '项目',
      base: '/aims/projects/:id',
      backTo: '/aims/projects',
      backLabel: '返回项目总览',
      actions: [
        {
          id: 'aims.project.create-work-item',
          module: 'aims',
          permission: {
            resource: 'work_items',
            action: 'create'
          }
        }
      ],
      groups: [
        {
          id: 'aims-project.overview',
          label: '',
          items: [
            {
              id: 'aims.project.overview',
              label: '项目概览',
              icon: 'i-lucide-layout-dashboard',
              path: '',
              module: 'aims',
              permission: {
                resource: 'projects',
                action: 'view'
              }
            }
          ]
        },
        {
          id: 'aims-project.plan-execution',
          label: '计划与执行',
          items: [
            {
              id: 'aims.project.plan',
              label: '里程碑',
              icon: 'i-lucide-flag',
              path: '/plan',
              module: 'aims',
              permission: {
                resource: 'work_items',
                action: 'view'
              }
            },
            {
              id: 'aims.project.requirements',
              label: '需求',
              icon: 'i-lucide-clipboard-list',
              path: '/requirements',
              module: 'aims',
              permission: {
                resource: 'requirements',
                action: 'view'
              }
            },
            {
              id: 'aims.project.goals',
              label: '项目目标',
              icon: 'i-lucide-target',
              path: '/work-items',
              module: 'aims',
              permission: {
                resource: 'work_items',
                action: 'view'
              }
            },
            {
              id: 'aims.project.board',
              label: '任务看板',
              icon: 'i-lucide-list-checks',
              path: '/board',
              module: 'aims',
              permission: {
                resource: 'work_items',
                action: 'view'
              }
            }
          ]
        },
        {
          id: 'aims-project.delivery-quality',
          label: '交付与质量',
          items: [
            {
              id: 'aims.project.documents',
              label: '项目文档',
              icon: 'i-lucide-files',
              path: '/documents',
              module: 'aims',
              permission: {
                resource: 'projects',
                action: 'view'
              }
            },
            {
              id: 'aims.project.output',
              label: '项目产出',
              icon: 'i-lucide-award',
              path: '/output',
              module: 'aims',
              permission: {
                resource: 'projects',
                action: 'view'
              }
            },
            {
              id: 'aims.project.releases',
              label: '项目版本',
              icon: 'i-lucide-git-branch',
              path: '/releases',
              module: 'aims',
              permission: {
                resource: 'projects',
                action: 'view'
              }
            }
          ]
        },
        {
          id: 'aims-project.team-investment',
          label: '团队与投入',
          items: [
            {
              id: 'aims.project.members',
              label: '项目成员',
              icon: 'i-lucide-users',
              path: '/members',
              module: 'aims',
              permission: {
                resource: 'projects',
                action: 'view'
              }
            },
            {
              id: 'aims.project.timesheet',
              label: '工时',
              icon: 'i-lucide-clock',
              path: '/timesheet',
              module: 'aims',
              permission: {
                resource: 'timesheet',
                action: 'view'
              }
            },
            {
              id: 'aims.project.weekly-reports',
              label: '周报',
              icon: 'i-lucide-calendar-days',
              path: '/weekly-reports',
              module: 'aims',
              permission: {
                resource: 'weekly_reports',
                action: 'view'
              }
            }
          ]
        },
        {
          id: 'aims-project.project-management',
          label: '项目管理',
          items: [
            {
              id: 'aims.project.metrics',
              label: '度量分析',
              icon: 'i-lucide-bar-chart-3',
              path: '/metrics',
              module: 'aims',
              permission: {
                resource: 'projects',
                action: 'view'
              }
            },
            {
              id: 'aims.project.risks',
              label: '风险管控',
              icon: 'i-lucide-shield-alert',
              path: '/risks',
              module: 'aims',
              permission: {
                resource: 'projects',
                action: 'view'
              }
            },
            {
              id: 'aims.project.edit',
              label: '项目设置',
              icon: 'i-lucide-settings',
              path: '/edit',
              module: 'aims',
              permission: {
                resource: 'projects',
                action: 'edit'
              }
            }
          ]
        }
      ]
    }
  ],
  registeredPages: [
    {
      path: '/aims',
      name: 'aims-index'
    },
    {
      path: '/aims/products',
      name: 'aims-products-shell'
    },
    {
      path: '/aims/products',
      name: 'aims-products'
    },
    {
      path: '/aims/products/:productCode',
      name: 'aims-product-workspace'
    },
    {
      path: '/aims/products/:productCode',
      name: 'aims-product-overview'
    },
    {
      path: '/aims/products/:productCode/structure',
      name: 'aims-product-structure'
    },
    {
      path: '/aims/products/:productCode/features',
      name: 'aims-product-features-legacy'
    },
    {
      path: '/aims/products/:productCode/components',
      name: 'aims-product-components-legacy'
    },
    {
      path: '/aims/products/:productCode/adoption',
      name: 'aims-product-adoption'
    },
    {
      path: '/aims/products/:productCode/documents',
      name: 'aims-product-documents'
    },
    {
      path: '/aims/products/:productCode/cycles',
      name: 'aims-product-cycles'
    },
    {
      path: '/aims/products/:productCode/features/:featureId',
      name: 'aims-product-feature-index'
    },
    {
      path: '/aims/products/:productCode/features/:featureId/requests',
      name: 'aims-product-feature-requests'
    },
    {
      path: '/aims/products/:productCode/features/:featureId/lifecycle',
      name: 'aims-product-feature-lifecycle'
    },
    {
      path: '/aims/products/:productCode/features/:featureId/roadmap',
      name: 'aims-product-feature-roadmap'
    },
    {
      path: '/aims/products/:productCode/requests',
      name: 'aims-product-requests'
    },
    {
      path: '/aims/products/:productCode/planning-items/:itemId/handoff',
      name: 'aims-product-handoff'
    },
    {
      path: '/aims/products/:productCode/execution-coordination',
      name: 'aims-product-execution-coordination'
    },
    {
      path: '/aims/products/:productCode/planning',
      name: 'aims-product-planning'
    },
    {
      path: '/aims/products/:productCode/versions',
      name: 'aims-product-versions'
    },
    {
      path: '/aims/products/:productCode/versions/:versionId',
      name: 'aims-product-version'
    },
    {
      path: '/aims/products/:productCode/versions/:versionId',
      name: 'aims-product-version-overview'
    },
    {
      path: '/aims/products/:productCode/versions/:versionId/acceptance',
      name: 'aims-product-version-acceptance'
    },
    {
      path: '/aims/products/:productCode/versions/:versionId/acceptances',
      name: 'aims-product-version-acceptances'
    },
    {
      path: '/aims/products/:productCode/versions/:versionId/acceptances/:acceptanceId',
      name: 'aims-product-version-acceptances-detail'
    },
    {
      path: '/aims/products/:productCode/versions/:versionId/releases',
      name: 'aims-product-version-releases'
    },
    {
      path: '/aims/products/:productCode/versions/:versionId/releases/:recordId',
      name: 'aims-product-version-releases-detail'
    },
    {
      path: '/aims/products/:productCode/versions/:versionId/plan',
      name: 'aims-product-version-plan'
    },
    {
      path: '/aims/products/:productCode/versions/:versionId/features',
      name: 'aims-product-version-features'
    },
    {
      path: '/aims/projects',
      name: 'aims-projects'
    },
    {
      path: '/aims/portfolios/:id',
      name: 'aims-portfolio-detail'
    },
    {
      path: '/aims/portfolios/:id/documents/:docId',
      name: 'aims-portfolio-document-open'
    },
    {
      path: '/aims/project-documents',
      name: 'aims-project-document-overview'
    },
    {
      path: '/aims/admin/projects',
      name: 'aims-admin-projects'
    },
    {
      path: '/aims/admin/projects/:id/edit',
      name: 'aims-admin-project-edit'
    },
    {
      path: '/aims/portfolios/new',
      name: 'aims-portfolio-new'
    },
    {
      path: '/aims/admin/weekly-reporting-settings',
      name: 'aims-admin-weekly-reporting-settings'
    },
    {
      path: '/aims/projects/new',
      name: 'aims-project-new'
    },
    {
      path: '/aims/projects/:id',
      name: 'aims-project-detail'
    },
    {
      path: '/aims/projects/:id/edit',
      name: 'aims-project-edit'
    },
    {
      path: '/aims/projects/:id/settings',
      name: 'aims-project-settings-compat'
    },
    {
      path: '/aims/projects/:projectId/work-items/new',
      name: 'aims-work-item-new'
    },
    {
      path: '/aims/work-items/:id/edit',
      name: 'aims-work-item-edit'
    },
    {
      path: '/aims/work-items/:id/association',
      name: 'aims-work-item-association'
    },
    {
      path: '/aims/projects/:id/timesheet',
      name: 'aims-project-timesheet'
    },
    {
      path: '/aims/projects/:id/timesheet/:entryId',
      name: 'aims-project-time-entry-detail'
    },
    {
      path: '/aims/projects/:id/weekly-reports',
      name: 'aims-project-weekly-reports'
    },
    {
      path: '/aims/projects/:id/weekly-reports/:periodKey',
      name: 'aims-project-weekly-report-detail'
    },
    {
      path: '/aims/projects/:id/members',
      name: 'aims-project-members'
    },
    {
      path: '/aims/projects/:id/documents',
      name: 'aims-project-documents'
    },
    {
      path: '/aims/projects/:id/documents/:documentId',
      name: 'aims-project-document-detail'
    },
    {
      path: '/aims/projects/:id/documents/:documentId/open',
      name: 'aims-project-document-open'
    },
    {
      path: '/aims/projects/:id/requirements',
      name: 'aims-project-requirements'
    },
    {
      path: '/aims/projects/:id/requirements/:requirementId',
      name: 'aims-project-requirement-detail'
    },
    {
      path: '/aims/projects/:id/metrics',
      name: 'aims-project-metrics'
    },
    {
      path: '/aims/projects/:id/risks',
      name: 'aims-project-risks'
    },
    {
      path: '/aims/projects/:id/output',
      name: 'aims-project-output'
    },
    {
      path: '/aims/projects/:id/output/:deliverableId',
      name: 'aims-project-output-detail'
    },
    {
      path: '/aims/projects/:id/releases',
      name: 'aims-project-releases'
    },
    {
      path: '/aims/projects/:id/releases/:releaseId',
      name: 'aims-project-release-detail'
    },
    {
      path: '/aims/projects/:id/plan',
      name: 'aims-project-plan'
    },
    {
      path: '/aims/projects/:id/board',
      name: 'aims-project-board'
    },
    {
      path: '/aims/projects/:id/board/:workItemId/execution',
      name: 'aims-project-board-execution'
    },
    {
      path: '/aims/timesheet',
      name: 'aims-timesheet'
    },
    {
      path: '/aims/weekly-reports',
      name: 'aims-weekly-reports'
    },
    {
      path: '/aims/projects/:id/work-items',
      name: 'aims-project-work-items'
    },
    {
      path: '/aims/projects/:id/work-items/:workItemId/append',
      name: 'aims-project-work-item-append'
    },
    {
      path: '/aims/projects/:id/work-items/:workItemId/breakdown',
      name: 'aims-project-work-item-breakdown'
    },
    {
      path: '/aims/projects/:id/work-items/:workItemId/decompose',
      name: 'aims-project-work-item-decompose'
    },
    {
      path: '/aims/work-items',
      name: 'aims-work-items'
    },
    {
      path: '/aims/work-items/:id',
      name: 'aims-work-item-detail'
    },
    {
      path: '/aims/admin',
      name: 'aims-legacy-page-0'
    },
    {
      path: '/aims/admin/products',
      name: 'aims-legacy-page-1'
    },
    {
      path: '/aims/admin/project-templates',
      name: 'aims-legacy-page-2'
    },
    {
      path: '/aims/board',
      name: 'aims-legacy-page-3'
    },
    {
      path: '/aims/embed/project/:bizId',
      name: 'aims-legacy-page-4'
    },
    {
      path: '/aims/help/pivr',
      name: 'aims-legacy-page-5'
    },
    {
      path: '/aims/integration-operations',
      name: 'aims-legacy-page-6'
    },
    {
      path: '/aims/login',
      name: 'aims-legacy-page-7'
    },
    {
      path: '/aims/product-setup',
      name: 'aims-legacy-page-8'
    },
    {
      path: '/aims/products/:productCode/cost-rules',
      name: 'aims-legacy-page-9'
    },
    {
      path: '/aims/products/:productCode/cost',
      name: 'aims-legacy-page-10'
    },
    {
      path: '/aims/products/:productCode/cycles/:cycleId/add-item',
      name: 'aims-legacy-page-11'
    },
    {
      path: '/aims/products/:productCode/cycles/:cycleId/budget',
      name: 'aims-legacy-page-12'
    },
    {
      path: '/aims/products/:productCode/cycles/:cycleId/capacity',
      name: 'aims-legacy-page-13'
    },
    {
      path: '/aims/products/:productCode/cycles/:cycleId/close',
      name: 'aims-legacy-page-14'
    },
    {
      path: '/aims/products/:productCode/cycles/:cycleId/edit',
      name: 'aims-legacy-page-15'
    },
    {
      path: '/aims/products/:productCode/cycles/:cycleId/items/:itemId/assess',
      name: 'aims-legacy-page-16'
    },
    {
      path: '/aims/products/:productCode/cycles/:cycleId/items/:itemId/assessments',
      name: 'aims-legacy-page-17'
    },
    {
      path: '/aims/products/:productCode/cycles/:cycleId/items/:itemId/commit',
      name: 'aims-legacy-page-18'
    },
    {
      path: '/aims/products/:productCode/cycles/:cycleId/items/:itemId/consumption',
      name: 'aims-legacy-page-19'
    },
    {
      path: '/aims/products/:productCode/cycles/:cycleId/items/:itemId/move',
      name: 'aims-legacy-page-20'
    },
    {
      path: '/aims/products/:productCode/cycles/:cycleId/items/:itemId/select',
      name: 'aims-legacy-page-21'
    },
    {
      path: '/aims/products/:productCode/cycles/:cycleId/items/:itemId/withdraw',
      name: 'aims-legacy-page-22'
    },
    {
      path: '/aims/products/:productCode/cycles/:cycleId/items',
      name: 'aims-legacy-page-23'
    },
    {
      path: '/aims/products/:productCode/cycles/:cycleId/matrix',
      name: 'aims-legacy-page-24'
    },
    {
      path: '/aims/products/:productCode/cycles/:cycleId/model',
      name: 'aims-legacy-page-25'
    },
    {
      path: '/aims/products/:productCode/cycles/:cycleId/observations/:observationId/correct',
      name: 'aims-legacy-page-26'
    },
    {
      path: '/aims/products/:productCode/cycles/:cycleId/observations',
      name: 'aims-legacy-page-27'
    },
    {
      path: '/aims/products/:productCode/cycles/:cycleId/observe',
      name: 'aims-legacy-page-28'
    },
    {
      path: '/aims/products/:productCode/cycles/:cycleId/open',
      name: 'aims-legacy-page-29'
    },
    {
      path: '/aims/products/:productCode/cycles/:cycleId/review',
      name: 'aims-legacy-page-30'
    },
    {
      path: '/aims/products/:productCode/cycles/:cycleId/roadmap',
      name: 'aims-legacy-page-31'
    },
    {
      path: '/aims/products/:productCode/cycles/new',
      name: 'aims-legacy-page-32'
    },
    {
      path: '/aims/products/:productCode/feature-version-matrix',
      name: 'aims-legacy-page-33'
    },
    {
      path: '/aims/products/:productCode/models',
      name: 'aims-legacy-page-34'
    },
    {
      path: '/aims/products/:productCode/models/new',
      name: 'aims-legacy-page-35'
    },
    {
      path: '/aims/products/:productCode/models/rice-new',
      name: 'aims-legacy-page-36'
    },
    {
      path: '/aims/products/:productCode/objectives/:objectiveId',
      name: 'aims-legacy-page-37'
    },
    {
      path: '/aims/products/:productCode/objectives',
      name: 'aims-legacy-page-38'
    },
    {
      path: '/aims/products/:productCode/objectives/new',
      name: 'aims-legacy-page-39'
    },
    {
      path: '/aims/products/:productCode/planning-items/:itemId/commitments',
      name: 'aims-legacy-page-40'
    },
    {
      path: '/aims/products/:productCode/planning-items/:itemId/dependencies',
      name: 'aims-legacy-page-41'
    },
    {
      path: '/aims/products/:productCode/planning-items/:itemId/feature',
      name: 'aims-legacy-page-42'
    },
    {
      path: '/aims/products/:productCode/planning-items/:itemId',
      name: 'aims-legacy-page-43'
    },
    {
      path: '/aims/products/:productCode/planning-items/:itemId/reach-new',
      name: 'aims-legacy-page-44'
    },
    {
      path: '/aims/products/:productCode/planning-items/:itemId/reach',
      name: 'aims-legacy-page-45'
    },
    {
      path: '/aims/products/:productCode/planning-items/:itemId/roadmap',
      name: 'aims-legacy-page-46'
    },
    {
      path: '/aims/products/:productCode/planning-items/:itemId/version',
      name: 'aims-legacy-page-47'
    },
    {
      path: '/aims/products/:productCode/release-comparison',
      name: 'aims-legacy-page-48'
    },
    {
      path: '/aims/products/:productCode/settings',
      name: 'aims-legacy-page-49'
    },
    {
      path: '/aims/products/:productCode/views',
      name: 'aims-legacy-page-50'
    },
    {
      path: '/aims/project-resources',
      name: 'aims-legacy-page-51'
    },
    {
      path: '/aims/projects/:id/environments',
      name: 'aims-legacy-page-52'
    },
    {
      path: '/aims/projects/:id/milestones/:milestoneId',
      name: 'aims-legacy-page-53'
    },
    {
      path: '/aims/projects/:id/service-desk',
      name: 'aims-legacy-page-54'
    },
    {
      path: '/aims/quality-reviews',
      name: 'aims-legacy-page-56'
    },
    {
      path: '/aims/reports',
      name: 'aims-legacy-page-57'
    },
    {
      path: '/aims/requirements/batch/:batchId',
      name: 'aims-legacy-page-58'
    },
    {
      path: '/aims/settings/profile',
      name: 'aims-legacy-page-59'
    },
    {
      path: '/assets',
      name: 'assets-index'
    },
    {
      path: '/assets/products',
      name: 'assets-products'
    },
    {
      path: '/assets/products/new',
      name: 'assets-product-create'
    },
    {
      path: '/assets/products/:id/edit',
      name: 'assets-product-edit'
    },
    {
      path: '/assets/products/:id',
      name: 'assets-product-detail'
    },
    {
      path: '/assets/admin/asset-categories',
      name: 'assets-product-category-admin'
    },
    {
      path: '/assets/admin/asset-categories/new',
      name: 'assets-product-category-create'
    },
    {
      path: '/assets/admin/asset-categories/:id/edit',
      name: 'assets-product-category-edit'
    },
    {
      path: '/assets/admin/dictionaries',
      name: 'assets-dictionaries'
    },
    {
      path: '/assets/physical',
      name: 'assets-physical-assets'
    },
    {
      path: '/assets/resources',
      name: 'assets-resource-assets'
    },
    {
      path: '/assets/digital-assets',
      name: 'assets-digital-assets'
    },
    {
      path: '/assets/digital-assets/new',
      name: 'assets-digital-assets-create'
    },
    {
      path: '/assets/digital-assets/:id/edit',
      name: 'assets-digital-assets-edit'
    },
    {
      path: '/assets/digital-assets/:id',
      name: 'assets-digital-asset-detail'
    },
    {
      path: '/assets/ip-assets',
      name: 'assets-ip-assets'
    },
    {
      path: '/assets/ip-assets/new',
      name: 'assets-ip-assets-create'
    },
    {
      path: '/assets/ip-assets/:id/edit',
      name: 'assets-ip-assets-edit'
    },
    {
      path: '/assets/ip-assets/:id',
      name: 'assets-ip-asset-detail'
    },
    {
      path: '/assets/items/:id',
      name: 'assets-asset-detail'
    },
    {
      path: '/codocs',
      name: 'codocs-index'
    },
    {
      path: '/codocs/mydocs',
      name: 'codocs-mydocs'
    },
    {
      path: '/codocs/mydocs/cabinet',
      name: 'codocs-mydocs-cabinet'
    },
    {
      path: '/codocs/mydocs/favorites',
      name: 'codocs-mydocs-favorites'
    },
    {
      path: '/codocs/mydocs/recently',
      name: 'codocs-mydocs-recently'
    },
    {
      path: '/codocs/mydocs/recycle',
      name: 'codocs-mydocs-recycle'
    },
    {
      path: '/codocs/mydocs/shared',
      name: 'codocs-mydocs-shared'
    },
    {
      path: '/codocs/mydocs/journal',
      name: 'codocs-mydocs-journal'
    },
    {
      path: '/codocs/mydocs/worklogs',
      name: 'codocs-mydocs-worklogs'
    },
    {
      path: '/codocs/mydocs/weekly-reports',
      name: 'codocs-mydocs-weekly-reports'
    },
    {
      path: '/codocs/documents/:uuid',
      name: 'codocs-document-editor'
    },
    {
      path: '/codocs/departments',
      name: 'codocs-department-documents'
    },
    {
      path: '/codocs/departments/records',
      name: 'codocs-department-records'
    },
    {
      path: '/codocs/departments/cabinet',
      name: 'codocs-department-cabinet'
    },
    {
      path: '/codocs/departments/outsides',
      name: 'codocs-department-outsides'
    },
    {
      path: '/codocs/departments/rules',
      name: 'codocs-department-rules'
    },
    {
      path: '/codocs/company/rules',
      name: 'codocs-company-rules'
    },
    {
      path: '/codocs/company/notice',
      name: 'codocs-company-notice'
    },
    {
      path: '/codocs/company/legal',
      name: 'codocs-company-legal'
    },
    {
      path: '/codocs/company/culture',
      name: 'codocs-company-culture'
    },
    {
      path: '/codocs/company/tech-specs',
      name: 'codocs-company-tech-specs'
    },
    {
      path: '/codocs/company/knowledge',
      name: 'codocs-company-knowledge'
    },
    {
      path: '/codocs/company/templates',
      name: 'codocs-company-templates'
    },
    {
      path: '/codocs/company/open-department-docs',
      name: 'codocs-company-open-department-docs'
    },
    {
      path: '/codocs/company/document',
      name: 'codocs-company-document'
    },
    {
      path: '/codocs/departments/document',
      name: 'codocs-department-document'
    },
    {
      path: '/codocs/s/:token',
      name: 'codocs-published-asset-short-link'
    },
    {
      path: '/finance',
      name: 'finance-index'
    },
    {
      path: '/finance/historical-finance',
      name: 'finance-historical-finance'
    },
    {
      path: '/finance/historical-finance/:code',
      name: 'finance-historical-finance-detail'
    },
    {
      path: '/finance/receipts/:code/allocate',
      name: 'finance-receipt-allocation'
    },
    {
      path: '/finance/receivable-adjustments',
      name: 'finance-receivable-adjustments'
    },
    {
      path: '/finance/receivable-adjustments/new',
      name: 'finance-receivable-adjustments-new'
    },
    {
      path: '/finance/receivable-adjustments/:code',
      name: 'finance-receivable-adjustments-detail'
    },
    {
      path: '/finance/allocation-batches',
      name: 'finance-allocation-batches'
    },
    {
      path: '/finance/allocation-batches/:code',
      name: 'finance-allocation-batch-detail'
    },
    {
      path: '/finance/migration',
      name: 'finance-migration'
    },
    {
      path: '/finance/legal-entities',
      name: 'finance-legal-entities'
    },
    {
      path: '/finance/project-accounting',
      name: 'finance-project-accounting'
    },
    {
      path: '/finance/project-accounting/:projectCode',
      name: 'finance-project-accounting-detail'
    },
    {
      path: '/finance/project-cost-allocations',
      name: 'finance-cost-allocations'
    },
    {
      path: '/finance/project-cost-allocations/:code',
      name: 'finance-cost-allocation-detail'
    },
    {
      path: '/finance/employee-costs',
      name: 'finance-employee-costs'
    },
    {
      path: '/finance/employee-costs/:code',
      name: 'finance-employee-cost-detail'
    },
    {
      path: '/finance/payment-requests',
      name: 'finance-payment-requests-list'
    },
    {
      path: '/finance/payment-requests/:code',
      name: 'finance-payment-requests-code'
    },
    {
      path: '/finance/payment-requests/new',
      name: 'finance-payment-requests-new'
    },
    {
      path: '/finance/payment-requests/:code/edit',
      name: 'finance-payment-requests-code-edit'
    },
    {
      path: '/finance/settings/expense-types',
      name: 'finance-settings-expense-types-list'
    },
    {
      path: '/finance/settings/expense-types/new',
      name: 'finance-settings-expense-types-new'
    },
    {
      path: '/finance/settings/expense-types/:code/edit',
      name: 'finance-settings-expense-types-edit'
    },
    {
      path: '/finance/settings/income-types',
      name: 'finance-settings-income-types-list'
    },
    {
      path: '/finance/settings/income-types/new',
      name: 'finance-settings-income-types-new'
    },
    {
      path: '/finance/settings/income-types/:code/edit',
      name: 'finance-settings-income-types-edit'
    },
    {
      path: '/finance/settings/subjects',
      name: 'finance-settings-subjects-list'
    },
    {
      path: '/finance/settings/subjects/new',
      name: 'finance-settings-subjects-new'
    },
    {
      path: '/finance/settings/subjects/:code/edit',
      name: 'finance-settings-subjects-edit'
    },
    {
      path: '/finance/settings/subject-mappings',
      name: 'finance-settings-subject-mappings-list'
    },
    {
      path: '/finance/settings/subject-mappings/new',
      name: 'finance-settings-subject-mappings-new'
    },
    {
      path: '/finance/settings/subject-mappings/:code/edit',
      name: 'finance-settings-subject-mappings-edit'
    },
    {
      path: '/finance/accounting-objects',
      name: 'finance-settings-accounting-objects-list'
    },
    {
      path: '/finance/accounting-objects/new',
      name: 'finance-settings-accounting-objects-new'
    },
    {
      path: '/finance/accounting-objects/:code/edit',
      name: 'finance-settings-accounting-objects-edit'
    },
    {
      path: '/finance/audit-logs',
      name: 'finance-settings-audit-logs-list'
    },
    {
      path: '/finance/integrations/approval-instances',
      name: 'finance-settings-approval-instances-list'
    },
    {
      path: '/finance/expenses',
      name: 'finance-expenses-list'
    },
    {
      path: '/finance/expenses/:code',
      name: 'finance-expenses-code'
    },
    {
      path: '/finance/expenses/new',
      name: 'finance-expenses-new'
    },
    {
      path: '/finance/expenses/:code/edit',
      name: 'finance-expenses-code-edit'
    },
    {
      path: '/finance/expenses/claims',
      name: 'finance-claims-list'
    },
    {
      path: '/finance/expenses/claims/:code',
      name: 'finance-claims-code'
    },
    {
      path: '/finance/expenses/claims/new',
      name: 'finance-claims-new'
    },
    {
      path: '/finance/expenses/claims/:code/edit',
      name: 'finance-claims-code-edit'
    },
    {
      path: '/finance/expenses/project-requests',
      name: 'finance-project-requests-list'
    },
    {
      path: '/finance/expenses/project-requests/:code',
      name: 'finance-project-requests-code'
    },
    {
      path: '/finance/expenses/project-requests/new',
      name: 'finance-project-requests-new'
    },
    {
      path: '/finance/expenses/project-requests/:code/edit',
      name: 'finance-project-requests-code-edit'
    },
    {
      path: '/finance/expenses/projects',
      name: 'finance-expenses-projects'
    },
    {
      path: '/finance/invoices/requests',
      name: 'finance-invoice-requests-list'
    },
    {
      path: '/finance/invoices/requests/:code',
      name: 'finance-invoice-requests-code'
    },
    {
      path: '/finance/invoices/requests/:code/edit',
      name: 'finance-invoice-requests-code-edit'
    },
    {
      path: '/finance/invoices/requests/new',
      name: 'finance-invoice-requests-new'
    },
    {
      path: '/finance/invoices',
      name: 'finance-invoices-list'
    },
    {
      path: '/finance/invoices/:code',
      name: 'finance-invoices-code'
    },
    {
      path: '/finance/invoices/:code/edit',
      name: 'finance-invoices-code-edit'
    },
    {
      path: '/finance/receipts',
      name: 'finance-receipts-list'
    },
    {
      path: '/finance/receipts/:code',
      name: 'finance-receipts-code'
    },
    {
      path: '/finance/receipts/:code/edit',
      name: 'finance-receipts-code-edit'
    },
    {
      path: '/finance/receipts/new',
      name: 'finance-receipts-new'
    },
    {
      path: '/finance/reconciliation',
      name: 'finance-reconciliation-list'
    },
    {
      path: '/finance/reconciliation/new',
      name: 'finance-reconciliation-new'
    },
    {
      path: '/finance/invoices/requests/:code/issue',
      name: 'finance-invoice-requests-issue'
    },
    {
      path: '/finance/invoices/requests/:code/assign-issuance',
      name: 'finance-invoice-requests-assign-issuance'
    },
    {
      path: '/finance/receipts/:code/classify',
      name: 'finance-receipts-classify'
    },
    {
      path: '/finance/reconciliation/:code/void',
      name: 'finance-reconciliation-void'
    },
    {
      path: '/finance/bank-accounts',
      name: 'finance-bank-accounts'
    },
    {
      path: '/finance/bank-accounts/balances',
      name: 'finance-balance-snapshots'
    },
    {
      path: '/finance/bank-accounts/:code',
      name: 'finance-bank-account-detail'
    },
    {
      path: '/finance/settings/people-cost-parameters',
      name: 'finance-people-cost-parameters'
    },
    {
      path: '/finance/settings/people-cost-parameters/new',
      name: 'finance-people-cost-parameter-create'
    },
    {
      path: '/finance/settings/people-cost-parameters/:code/edit',
      name: 'finance-people-cost-parameter-edit'
    },
    {
      path: '/people',
      name: 'people-index'
    },
    {
      path: '/people/directory-recovery',
      name: 'people-directory-recovery'
    },
    {
      path: '/people/offboarding',
      name: 'people-offboarding'
    },
    {
      path: '/people/offboarding/:id',
      name: 'people-offboarding-detail'
    },
    {
      path: '/people/settings/hr-source-sync',
      name: 'people-hr-source-sync'
    },
    {
      path: '/people/onboarding',
      name: 'people-onboarding'
    },
    {
      path: '/people/employees',
      name: 'people-employees'
    },
    {
      path: '/people/employees/:id',
      name: 'people-employee-detail'
    },
    {
      path: '/people/assignments',
      name: 'people-assignments'
    },
    {
      path: '/people/assignments/:id',
      name: 'people-assignment-detail'
    },
    {
      path: '/people/settings/positions',
      name: 'people-positions'
    },
    {
      path: '/people/settings/ranks',
      name: 'people-ranks'
    },
    {
      path: '/people/settings/standard-costs',
      name: 'people-standard-costs'
    },
    {
      path: '/enterprise',
      name: 'enterprise-workbench'
    },
    {
      path: '/enterprise/notifications',
      name: 'console-host-notifications'
    },
    {
      path: '/enterprise/notifications/:notificationId',
      name: 'console-host-notifications-notificationId'
    },
    {
      path: '/enterprise/todos',
      name: 'console-host-todos'
    },
    {
      path: '/enterprise/announcements',
      name: 'console-host-announcements'
    },
    {
      path: '/enterprise/announcements/manage',
      name: 'console-host-announcements-manage'
    },
    {
      path: '/enterprise/announcements/:announcementId',
      name: 'console-host-announcement-detail'
    },
    {
      path: '/enterprise/help',
      name: 'console-host-help'
    },
    {
      path: '/enterprise/feedback',
      name: 'console-host-feedback-list'
    },
    {
      path: '/enterprise/feedback/:feedbackId',
      name: 'console-host-feedback-detail'
    },
    {
      path: '/altoc/customers',
      name: 'altoc-host-customers'
    },
    {
      path: '/altoc/customers/:customerId',
      name: 'altoc-host-customers-detail'
    },
    {
      path: '/altoc/contracts',
      name: 'altoc-host-contracts'
    },
    {
      path: '/altoc/contracts/:contractId',
      name: 'altoc-host-contracts-detail'
    },
    {
      path: '/altoc/payments',
      name: 'altoc-host-payments'
    },
    {
      path: '/altoc/payments/:planId',
      name: 'altoc-host-payments-detail'
    },
    {
      path: '/altoc/leads',
      name: 'altoc-host-leads'
    },
    {
      path: '/altoc/leads/:leadId',
      name: 'altoc-host-leads-detail'
    },
    {
      path: '/altoc/opportunities',
      name: 'altoc-host-opportunities'
    },
    {
      path: '/altoc/opportunities/:opportunityId',
      name: 'altoc-host-opportunities-detail'
    },
    {
      path: '/altoc/quotes',
      name: 'altoc-host-quotes'
    },
    {
      path: '/altoc/quotes/:quotationId',
      name: 'altoc-host-quotes-detail'
    },
    {
      path: '/altoc/tenders',
      name: 'altoc-host-tenders-list'
    },
    {
      path: '/altoc/tenders/new',
      name: 'altoc-host-tenders-new'
    },
    {
      path: '/altoc/tenders/:tenderId',
      name: 'altoc-host-tenders-detail'
    },
    {
      path: '/altoc/service-agreements',
      name: 'altoc-host-service-agreements-list'
    },
    {
      path: '/altoc/service-agreements/new',
      name: 'altoc-host-service-agreements-new'
    },
    {
      path: '/altoc/service-agreements/:agreementId',
      name: 'altoc-host-service-agreements-detail'
    },
    {
      path: '/altoc/service-tickets',
      name: 'altoc-host-service-tickets-index'
    },
    {
      path: '/altoc/service-tickets/new',
      name: 'altoc-host-service-tickets-new'
    },
    {
      path: '/altoc/service-tickets/:ticketId',
      name: 'altoc-host-service-tickets-detail'
    },
    {
      path: '/altoc/renewals',
      name: 'altoc-host-renewals-list'
    },
    {
      path: '/altoc/renewals/new',
      name: 'altoc-host-renewals-new'
    },
    {
      path: '/altoc/renewals/:renewalId',
      name: 'altoc-host-renewals-detail'
    },
    {
      path: '/altoc/migration',
      name: 'altoc-host-migration'
    }
  ],
  navigationSources: [
    {
      appCode: 'aims',
      manifestHash: '685a785cc888b4cf6526d112b19ce9c9fae5b24763cda6195ca4c1d4dc79111b'
    },
    {
      appCode: 'assets',
      manifestHash: 'cb47c707f93b1583d72775343da02c9ad2e75c55a095e21dcc55419d1d399696'
    },
    {
      appCode: 'codocs',
      manifestHash: '1fc99b40accddd545b1cb011344ff095bc9477bd6398f44ccfe7e77160f462ce'
    },
    {
      appCode: 'finance',
      manifestHash: '12d619be4b5207d2f04679149f2927386e90f5f2488b8fd0052d8a1e8f4a8398'
    },
    {
      appCode: 'people',
      manifestHash: '7794054d3c8c971c82201f108f1c33a76a153d7df84da2b57bbe88e9db213bc4'
    },
    {
      appCode: 'console',
      manifestHash: 'b42b2597864f3ec0754f1f85150f70dd602f62e97af210e767ce400ca20efd4f'
    },
    {
      appCode: 'altoc',
      manifestHash: 'd779c5ce1830c0a6d2faff6e6338b12eff63361abdbbb0a35a217687d1c664a6'
    }
  ]
} as const
