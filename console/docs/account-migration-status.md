# Account to Console Migration Status

Console is now the replacement runtime for Account-owned tenant directory and runtime compatibility capabilities.

## Migrated Runtime Capabilities

- Company profile, business domains and regions are modeled by `org_profiles`, `org_business_domains`, `regions` and exposed through Console company APIs.
- Directory users are maintained in `directory_users` and exposed through Console admin APIs plus Account-compatible read APIs.
- Directory departments are maintained in `directory_departments` and `directory_user_departments`.
- Project registry data is maintained in `directory_projects` and `directory_project_members`.
- Clipboard, heartbeat, login events and operation logs are handled by Console runtime compatibility tables.
- Current user permissions and application visibility are resolved from the signed Platform policy bundle.

## Migration Entry Points

- Manual user maintenance: `/directory/users`
- Manual department maintenance: `/directory/departments`
- Manual committee and membership maintenance: `/directory/committees`
- Manual project registry maintenance: `/directory/projects`
- Account import: `/directory/sync` -> `导入 Account`
- Subject export rebuild: `/directory/sync` -> `重建 subject export`

The Account import sync reads legacy Account tables from the same database connection:

- `departments` -> `directory_departments`
- `system_users` -> `directory_users` and `directory_identities`
- `user_departments` -> `directory_user_departments`
- `git_projects` -> `directory_projects`
- `git_project_members` -> `directory_project_members`

## Compatibility APIs

Console keeps Account-compatible read endpoints under `/api/account/*` and public v1 directory aliases under `/api/v1/*` so dependent modules can move without changing all callers at once. These are browser compatibility façades over Console tables, never a proxy or fallback to the legacy Account service.

- Directory users, departments, project registry, member lists, and user-to-department/project relations require the same authenticated `directory_*:view` permission as `/api/v1/directory/**` before any directory query.
- `accessible-departments` and clipboard compatibility APIs require a verified Console local session and can only read or write the current session UID; browser query/body UIDs cannot select another user.
- `config-check` is a legacy browser configuration probe and requires a verified Console local session. None of these routes accept a service identity as a substitute for user authorization.

## Configuration Boundary

Console no longer consumes `HZY_ACCOUNT_API_URL`, `HZY_ACCOUNT_API_KEY`, or `HZY_ACCOUNT_API_SECRET`; the Console env examples do not declare them. Legacy Account remains only an import source for the explicit directory-sync workflow, not a runtime upstream or compatibility fallback.

## Out of Scope

GitLab repository document operations, AI APIs, mail demo APIs and Account-only admin screens are not Console ownership. They should remain in their owning business modules or move to dedicated modules, not into Console.
