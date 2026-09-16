# Workflow Legacy Directory Compatibility API

> Status: migration-only compatibility surface. Last verified: 2026-07-11.

`/api/account/**` is a historical browser BFF namespace, not an Account
service dependency. The Workflow routes below use Foundation's Console
Directory adapter exclusively; they must not call `account`, use `HZY_ACCOUNT_*`
configuration, or fall back to an Account response when Console rejects a
request.

| Legacy path | Console-backed behavior | Request boundary |
| --- | --- | --- |
| `GET /api/account/config-check` | Reports Directory adapter configuration only | Verified Console request subject required before reading config |
| `GET /api/account/departments` | Proxies the Console department directory | Verified Console request subject required |
| `GET /api/account/users`, `GET /api/account/users/:uid`, `POST /api/account/users/batch` | Proxies collaborative user-directory projections | Verified Console request subject required before query/path/body or Directory access |
| `GET /api/account/user-departments?uid=` | Returns the current subject's department relations | Verified subject only; a supplied `uid` must equal it, and an omitted `uid` resolves to it |

These routes sit outside Workflow's `/api/v1/**` tenant-runtime middleware.
Each therefore resolves the Foundation Console session bridge before it can
inspect configuration, accept a request body, or use the application Directory
adapter. Generic user and department projections remain available to an
already-authenticated collaborator; this compatibility layer does not invent a
new application permission model.

Console `401` and `403` responses are propagated by the Directory adapter and
must fail fast. Adapter or Console availability failures must not be treated as
an empty directory or be retried through Account.

## Legacy WeCom browser login

Console OIDC is Workflow's default user-login path. Historical
`GET /api/auth/wecom-login` and `GET /api/auth/wecom-callback` are direct
WeCom login paths and are available only when `HZY_AUTH_MODE=legacy` or
`HZY_LEGACY_AUTH_BRIDGE=true` is explicitly configured. In the default mode
both routes return `410` before reading browser query input, resolving a WeCom
integration, exchanging an OAuth `code`, or writing a legacy cookie. Clients
must redirect to Console OIDC instead.
