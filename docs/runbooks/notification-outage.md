# Notification Outage Runbook

## Symptoms
- Notifications remain `queued` or move to `failed`.
- Dispatch summary shows repeated failures/dead letters.

## Immediate Actions
1. Open Notifications page and run `Dispatch Queue` with a low limit.
2. Inspect failed rows and audit events:
   - `notification_send_failed`
   - `notification_dead_lettered`
3. Confirm recipient formatting and template syntax.

## Recovery
1. Fix bad recipients/config in Notifications configuration.
2. Re-dispatch queue after corrections.
3. For urgent cases, use Manual Override Queue with explicit reason (audited).

## Prevention
- Keep `maxAttempts` at 3 or higher for transient failures.
- Validate recipient lists during policy rollout.
