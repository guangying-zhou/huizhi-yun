# Dead-letter actionable runtime contract v1

Aims and Altoc expose the same source-owned runtime contract. Every request is bound by the trusted runtime tenant, deployment and source application context and requires the existing integration-operation worker capability.

## Publish scan

`POST /v1/{app}/integration-operations:pending-dead-letter-actionables`

Request: `{"limit":1..20}`.

Each item contains only `tenantCode`, `deploymentCode`, `sourceApp`, `targetApp`, `operationId`, `operationCode`, `sourceBizType`, `sourceBizCode`, `attemptCount`, `maxAttempts`, nullable `lastErrorCode` / `lastErrorClass` / `originalActorUid`, `deadLetteredAt`, `generation`, `operationVersion`, `actionableKey` and `objectVersion`. It never contains the operation key, idempotency key, command, hashes, raw error/response, token or URL.

A generation is materialized once from the dead-letter operation version. A newer generation is not returned until every older generation closure has been acknowledged.

## Publish acknowledgement

`POST /v1/{app}/integration-operations/{operationId}:dead-letter-actionable-published`

Request:

```json
{
  "generation": 7,
  "operationVersion": 7,
  "actionableKey": "integration-operation:{app}:{operationId}:dead-letter:g7",
  "objectVersion": "dead-letter:g7:operation-v7",
  "notificationId": "console-notification-id",
  "recipientUids": ["explicit-uid"]
}
```

The recipient list contains 1..100 explicit UIDs, is deduplicated and sorted, and rejects `@all`. The exact generation, versions, key, notification ID and recipient JSON form an idempotent CAS; conflicting evidence returns 409.

## Closure scan

`POST /v1/{app}/integration-operations:pending-dead-letter-closures`

Request: `{"limit":1..20}`.

Items contain only `tenantCode`, `deploymentCode`, `sourceApp`, `operationId`, `generation`, `actionableKey`, `expectedVersion`, `nextVersion`, `state` and `recipientUids`. Replay creates a `cancelled` closure in the same transaction. Terminal success, including an idempotent-success failure decision, creates a `resolved` closure in the same transaction.

## Closure acknowledgement

`POST /v1/{app}/integration-operations/{operationId}:dead-letter-closure-acknowledged`

Request contains the exact `generation`, `actionableKey`, `expectedVersion`, `nextVersion` and `state`. First acknowledgement and identical replay succeed; stale or conflicting evidence returns 409.

## Notification-detail authorization

The existing `POST /v1/{app}/notification-details/authorize` accepts the exact descriptor `{"resource":"integration_operation","id":"<lowercase UUIDv4>"}`. It returns only `authorized`, `reasonCode`, `resource` and `id`. Authorization requires the exact notification ID, trusted tenant/deployment/source, current dead-letter generation, publish acknowledgement, an unclosed generation and subject membership in the persisted Console recipient evidence. Conservative denials use `not_found`, `not_recipient` or `stale_notification`.

