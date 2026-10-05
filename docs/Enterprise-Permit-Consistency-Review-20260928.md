# Enterprise Runtime permit consistency review (2026-09-28)

Reviewer: Claude. Scope: every `routeEnterprise*` handler and every Enterprise permit validator in `data-runtime/internal/server` and `internal/enterprisecontracts` at commit 5cac5ee5 (Runtime 0.3.273 lineage). Method: static review of the checks each route performs before touching business data. It does not replace per-feature tests or environment acceptance.

## Result

No route was found that reaches business data without authentication and a bound, short-lived authorization. No vulnerability was found.

| Check | Result |
| --- | --- |
| Each Enterprise route authenticates first | Yes. User-facing routes use `authenticateEnterpriseRequest` (service token, Console credential/grant state, signed actor). Scheduler routes use `authenticateEnterpriseScheduler*`. Cutover activation uses the Runtime control token. Altoc reads use their own authenticator plus a separate signature. |
| Permit bound to the verified actor | Yes, in all 25 `validate*Permit` validators (two delegate to one that checks), in the Assets scope helpers (`enterprise*ReadScope`; the edit variants first require `Action == "edit"` and then reuse the read checks), in the inline checks (product list, request create), and in contract activation (`enterprisecontracts/authorization.go`). |
| Tenant and Host deployment bound | Yes, in the same places. |
| Expiry present with an upper bound | Yes: every permit must expire in the future and no more than 15 s ahead. Contract activation uses the earliest of its two permits. |
| Routes without a permit | By design: `product authorization-object` (it is the fact source the Host builds permits from), `directory self` (the actor's own directory facts), scheduler routes, and cutover activation. |

## Observation (not a defect): two integrity patterns

Most permits are request-body facts asserted by the Host under the `enterprise.runtime` service identity. The service token, the Console credential/grant state and the signed actor protect them; the permit body itself is not separately signed. A few permits add a separate body HMAC keyed by the request's bearer token: project document accessible list, Altoc reads, timesheet review queue, weekly-report submit.

Both patterns fit the ADR-018 trust model: the Host is trusted to compute the user's authorization facts from Console, and the Runtime independently re-checks object relationships and scope. The separate HMAC binds a permit to one request and token. It does not protect against a compromised Host, which holds the token.

Recommendation: record this rule in `MODULE_CONTRACTS.md`. Use a separate body signature when a permit carries facts that are expanded into internal query flags (as with the weekly-report submit flag) or crosses an additional hop. Otherwise the standard bound permit is sufficient. Future permits should follow that rule instead of choosing case by case.

## Not covered

- Host-side construction of each permit, which was reviewed per feature at commit time.
- Runtime business SQL scope, which is covered by the PA-01 batches and their isolated MySQL tests.
- Standalone (non-Enterprise) application routes.
