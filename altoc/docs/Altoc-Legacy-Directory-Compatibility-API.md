# Altoc Legacy Directory Compatibility API

Last verified: 2026-07-11  
Source of truth: Foundation Console Directory adapter and the current Altoc implementation.

`/api/account/**` is retained only as a historical browser BFF path name. It
does not call legacy Account and it has no Account fallback: Directory reads
use the Foundation Console provider, and Console `401`/`403` responses fail
fast.

Before the BFF reads Directory configuration or invokes the application's
Directory adapter credentials, it resolves a verified Console request session
through the Foundation session bridge. An absent or invalid session returns
`401`; an explicitly configured legacy bridge remains subject to the existing
application auth-mode policy and is not an Account API fallback.

The routes below are authenticated compatibility reads:

- `GET /api/account/config-check`
- `GET /api/account/departments`
- `GET /api/account/projects`
- `GET /api/account/users`, `GET /api/account/users/{uid}`, and `POST /api/account/users/batch`
- `GET /api/account/user-departments`
- `GET /api/account/users/{uid}/projects`

`user-departments` and `users/{uid}/projects` are self-service relationship
views. If a `uid` is supplied, it must equal the verified session UID; a
mismatch is `403`. Omitting `uid` from `user-departments` selects the verified
current user rather than making an unscoped Directory request. General user,
department, and project lists remain authenticated collaborative directory
projections; they are not anonymous APIs.

## Direct WeCom login boundary

Altoc's normal browser sign-in path is Foundation-backed Console OIDC. The
historical `GET /api/auth/wecom-login` and `GET /api/auth/wecom-callback` are
available only when `HZY_AUTH_MODE=legacy` or `HZY_LEGACY_AUTH_BRIDGE=true` is
explicitly enabled. In the default mode each route returns `410` before
reading query input, resolving or calling WeCom, redirecting, writing cookies,
or recording a legacy login audit.

This document records only the BFF compatibility contract. It does not
authorize deployments, migrations, external requests, or Account changes.
