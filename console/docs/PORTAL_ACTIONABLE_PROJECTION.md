# Console Actionable Projection

## Purpose

`portal_notifications` and `portal_notification_recipients` remain immutable
notification history plus per-user read/archive state. Current actionable work
is stored separately in `portal_actionable_projections` so closing a task never
rewrites or removes notification history.

Console uses one tenant database connection per request/deployment. The
projection inherits that database isolation boundary; tenant/deployment values
from a notification payload are not trusted as row partition keys.

## Identity and state

The projection identity is `(uid, source_app_code, actionable_key)`.
`actionable_key` identifies one generation. Reopening a completed business
object must publish a new generation key; a terminal key can never return to
`pending`.

Each projection stores:

- `current_notification_id`: immutable notification that created the generation.
- `biz_type`, `biz_id`, `business_key`, and optional `target_app_code`.
- `state`: `pending`, `resolved`, or `cancelled`.
- opaque `object_version`, updated only by compare-and-swap.

The first genuinely new notification may create a projection. Canonical
notification replay returns before recipient or projection writes. A later
notification with an existing projection key remains notification history and
does not mutate the current projection.

Workflow pending notifications are recognized from their existing hash-bound
`eventType`, `metadata.actionableKey`, `metadata.eventVersion`,
`metadata.bizKey`, and `metadata.targetAppCode`. Other producers opt in with
`metadata.actionableState = "pending"` and the same stable metadata fields.

## Lifecycle service API

```text
POST /api/v1/console/notifications/actionable-lifecycle
Authorization: Bearer <aud=notifications, scope=notifications:publish>
```

Example:

```json
{
  "sourceAppCode": "workflow",
  "actionableKey": "workflow:tasks:sha256:...",
  "expectedVersion": "flow_tasks:sha256:...",
  "nextVersion": "flow_actions:1024",
  "state": "resolved",
  "recipients": ["U001"]
}
```

The verified service actor supplies `source_app_code`; a mismatched request is
403. Lifecycle accepts only `resolved` or `cancelled`. It locks all selected
rows, checks every `expectedVersion`, and performs an SQL CAS. Exact
`(state,nextVersion)` replay is a zero-write success. A stale version or any
different request against a terminal row returns 409.

Workflow still needs a follow-up integration change to call this endpoint when
tasks complete, delegate away, reject, or are withdrawn. Until that wiring is
shipped, Console can create real pending projections from current Workflow
notifications, but those rows can become stale after Workflow state changes.

## Employee portal summary

`GET /api/v1/console/notifications/todos/summary` binds the query to the current
Console user and counts only `pending` projections. `category=approval` feeds
approval counts; all other actionable categories feed follow-up counts.
Read/archive state does not close business work and therefore does not affect
the todo count.

## Safe notification envelope and authorized detail

Notification list and summary endpoints return only a Console-generated safe
envelope: notification/source/category/severity, a generic display label,
timestamps, and the current recipient read/archive state. They never return a
source-defined title, summary, body, action URL, business identity, metadata,
creator, or idempotency key.

`GET /api/v1/console/notifications/{notificationId}/detail` first binds the row
to the authenticated recipient. Console then constructs a server-only source
authorization descriptor and calls:

```text
POST /api/v1/service/notification-details/authorize
Authorization: Bearer <aud={sourceAppCode}, scope={sourceAppCode}:notification-details:authorize>
```

The request carries `{ notificationId, descriptor, subject: { uid }, tenantId, deploymentId }`.
Tenant/deployment come only from trusted Gateway context or Console server
runtime configuration; notification, descriptor, and subject are generated
from the authenticated recipient row and cannot be supplied by the browser.
Workflow identity is `workflow_task` with
`instance:{instanceId}:tasks:{sortedUniqueTaskIds}` (or `workflow_instance`
with the instance ID when no task exists); Aims identity is `work_item` with a
normalized numeric ID. Assets requires an exact metadata
`authorizationDescriptor:{resource:'asset_item'|'ip_asset'|'customer_delivery_asset'|'offboarding_recovery_case',id:objectCode}` with
the same values mirrored in `bizType/bizId`; extra descriptor fields or drift
fail closed. Assets is supported only through the direct source verifier:
Console does not run an Assets scoped challenge. Console releases the whitelisted detail fields only
when the source explicitly returns `authorized=true` and exactly echoes
`resource/id`.

Assets offboarding recovery notifications use the exact descriptor
`{resource:'offboarding_recovery_case',id:caseCode}`, mirrored by
`bizType/bizId`. The source re-reads the current open recovery case and allows
only its explicit active `recovery_responsible_uid`; the departed user,
department, administrator and configured recipients are never fallback
relations. An unassigned case remains visible in the Assets recovery worklist
but is not published as a notification.

Console-produced People employment/offboarding authorization lifecycle failure
notifications are the only locally authorized Console detail type. Their exact
descriptor is `{resource:'people_lifecycle_authorization',id:uid}`, mirrored by
`bizType/bizId`; missing, drifted, generic, or extra descriptor fields fail
closed. After binding the notification row to the authenticated recipient,
Console refreshes managed policy when applicable, ignores authorization
simulation, bypasses the process snapshot cache, and requires both current
`console:authorization_lifecycle:view` and `console:audit_logs:view`. This path
does not request a service token or enable any other `sourceAppCode=console`
notification. The action URL remains subject to the normal server-side URL
allowlist, and title/summary/body are released only after the local permission
decision succeeds.

The lifecycle metrics read API requires those same two current read grants
before querying audit data. A browser retry is an identity-only command
(`phase`, `uid`): it cannot send a position, department, reason, idempotency
key, or operation ID. Console resolves exactly one current
tenant/deployment-bound dead-letter source operation and uses its frozen
command facts; zero or multiple matches fail closed. After Platform accepts
the retry, cancellation is an exact tenant, deployment, operation, phase, and
user compare-and-set update.

The lifecycle admin timeline is a separate read-only view of the durable
Console-to-Platform outbox. Both its operation list and its per-operation
attempt route require the same current `authorization_lifecycle:view` and
`audit_logs:view` grants before resolving the Console runtime tenant/deployment
binding. The query permits only Console-to-Platform employment-sync and
offboarding-revoke operation codes in that binding. Its browser allow-list is
limited to operation ID, lifecycle code, user ID, status, attempt count,
stable error code/class and timestamps; attempt rows additionally expose only
attempt number, status, stable error code and timestamps. Command content,
idempotency/correlation material, hashes, receipts, leases, fencing values,
raw error summaries, responses, tokens and internal URLs remain server-only.

People likewise uses only a direct source verifier. Its descriptor must be the
exact object `{resource:'offboarding_task',id:taskCode}` and must be mirrored
exactly by `bizType=offboarding_task` and `bizId=taskCode`. Console calls People
with `aud=people` and `scope=people:notification-details:authorize`; it does not
run a People scoped challenge or infer access from employee, assignment,
department, or administrator permissions.

For an Aims non-member that may hold `aims/projects/admin`, the source may
return a server-only phase-1 challenge. Its exact tuple is fixed to
`aims/projects/admin`; object facts are restricted to project code/id,
department code, and confidentiality level, plus an object revision and a
SHA-256 facts hash bound to the notification, descriptor, subject, tenant and
deployment. Console injects the authenticated actor, a non-member sentinel and
an empty relation set; it builds `departmentTree` only from the local active
Directory. Managed-cloud authorization refreshes and validates the bound
policy bundle before a normal merged decision, ignores simulation and bypasses
the process snapshot cache. A positive decision is not final: Console calls
`POST /api/v1/service/notification-details/authorize/finalize`, and releases
the detail only after Aims re-reads the same revision, reapplies domain rules
(including L3 department denial), and exactly echoes facts/object/policy
revision, non-empty bundle hash, and normalized scope-basis evidence.

Source denial or a missing object returns a restricted result. Missing
verifiers, timeouts, throttling, malformed responses, and source/runtime
failures return unavailable. There is no authorization cache or stale-detail
fallback. Returned details exclude raw metadata, business keys, creator and
idempotency identity. Published and returned action URLs must be HTTP(S)
absolute URLs or single-slash application paths; protocol-relative, script,
data, credential-bearing, control-character, and backslash URLs are rejected.

Notification mutation routes require modern service identity claims before
reading a request body: `hzy.appCode` and `source_app` must both be present and
equal, and app/tenant/deployment must match the trusted Console runtime binding.
The publish payload source must exactly match that verified app identity.
Finance uses the same direct verifier with `aud=finance` and
`scope=finance:notification-details:authorize`. Its descriptor is exactly
`{resource:'invoice_request',id:<requestCode>}` or
`{resource:'finance_receipt',id:<receiptCode>}` and must mirror `bizType/bizId`.
Finance re-evaluates the current direct responsibility and open business
condition; Console does not infer a manager, department, administrator or
configured fallback recipient.

Altoc receivable due notifications use `aud=altoc` and
`scope=altoc:notification-details:authorize`. The only accepted descriptor is
`{resource:'receivable_plan',id:planCode}`, mirrored exactly by `bizType/bizId`.
Altoc authorizes only the plan's current explicit `collection_responsible_uid`
while the receivable condition remains actionable; contract owner, department,
administrator, configuration and `@all` are never fallback relations.
