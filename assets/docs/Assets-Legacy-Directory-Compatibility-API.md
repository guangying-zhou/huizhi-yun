# Assets Legacy Directory Compatibility API

> Status: legacy browser-path compatibility only. Last verified: 2026-07-11.

`/api/account/**` is retained only so existing Assets pages can continue to
read the Console Directory while their historical route names are retired.
These routes do not call the legacy Account service and must not become a
fallback for the Foundation Console Directory adapter.

## Authentication and scope

- Every compatibility route resolves the current Console session through the
  Foundation session bridge before reading configuration or calling the
  Directory adapter. A missing verified subject returns `401`; a downstream
  Console `401` or `403` is propagated without Account fallback.
- `GET /api/account/user-departments?uid=` and
  `GET /api/account/users/{uid}/projects` are self-service relationship
  reads. A supplied UID must exactly equal the verified subject, otherwise
  they return `403`. Omitting `uid` on `user-departments` reads the verified
  subject only.
- User list/detail/batch, department, and project-registry reads are retained
  as logged-in collaborative directory projections. They require a session but
  are not an authorization substitute for Assets business objects.

## Route mapping

| Legacy route | Console Directory target | Constraint |
| --- | --- | --- |
| `GET /api/account/departments` | `GET /api/v1/directory/departments` | logged-in session |
| `GET /api/account/projects` | `GET /api/v1/directory/projects` | logged-in session |
| `GET /api/account/users`, `/{uid}`, `/batch` | Console user directory endpoints | logged-in session |
| `GET /api/account/user-departments?uid=` | user-department projection | exact self binding |
| `GET /api/account/users/{uid}/projects` | user project relation | exact self binding |
| `GET /api/account/config-check` | local Console Directory configuration summary | logged-in session |

No route in this namespace writes the Directory registry. New Assets features
must use Foundation's Console Directory adapter under their own current API
namespace, not this compatibility surface.

## Direct WeCom login boundary

Assets browser sign-in normally uses Foundation-backed Console OIDC. The
historical `GET /api/auth/wecom-login` and `GET /api/auth/wecom-callback` are
available only with explicit `HZY_AUTH_MODE=legacy` or
`HZY_LEGACY_AUTH_BRIDGE=true`. The default mode returns `410` before reading
query input, resolving or calling WeCom, redirecting, writing a cookie, or
recording the legacy audit.
