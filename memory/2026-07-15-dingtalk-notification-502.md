# DingTalk notification 502 investigation

Date: 2026-07-15

## Symptom

The production Console DingTalk acceptance action returned HTTP 502 while Connector Runtime remained healthy.

## Root cause

The Cloudflare-to-Connector route, JWT, Console integration read, Vault resolution and DingTalk access-token exchange were healthy. The 502 was the public mapping of successive DingTalk configuration rejections:

1. the configured AppKey/Agent ID fields were initially confused;
2. the DingTalk application lacked `qyapi_robot_sendmsg`;
3. the application had no published robot capability, so DingTalk returned `invalidParameter.robotCode.notExsit`;
4. the newly created robot capability still required a new application version before it became effective.

No Connector Runtime network, SQLite or Cloudflare failure was found.

## Resolution

- corrected the AppKey, Corp ID and Robot Code mapping;
- kept AppSecret in Console Vault with the database-encrypted backend;
- enabled `qyapi_robot_sendmsg` and published the permission change;
- created and published the DingTalk robot capability and application version;
- copied the generated Robot Code back to `dingtalk.default`;
- ran the production Console send-and-replay acceptance flow.

## Verification

- Console integration status: `healthy`;
- Connector journal: one `notification sent provider=dingtalk integration=dingtalk.default` event;
- first runtime call performed the provider delivery and the second returned from durable replay;
- SQLite delivery 23: `succeeded`, `attempt_count=1`, no error code;
- no AppSecret, access token, recipient payload or message body was written to the report or operational diagnostics.

## Follow-up

The generic provider 502 mapping made the supplier prerequisite failure harder to diagnose. A future hardening change should map known DingTalk permission and Robot Code errors to safe actionable diagnostics without persisting supplier payloads or identifiers.
