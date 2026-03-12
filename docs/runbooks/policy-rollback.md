# Policy Rollback Runbook

## Trigger Conditions
- Incorrect thresholds or milestone templates deployed.
- Unexpected intervention spikes immediately after evaluation.

## Immediate Actions
1. Create a corrected policy version in Policies page.
2. Re-run Policy Evaluation against corrected version.
3. Review intervention deltas:
   - created
   - reopened
   - closed

## Recovery
1. Update intervention statuses for any manually corrected cases.
2. Re-queue and dispatch notifications only after validation.
3. Confirm audit history includes:
   - `policy_created`
   - `policy_evaluated`
   - intervention transition events

## Prevention
- Stage policy changes in a non-production spreadsheet first.
- Validate with a representative student sample before full evaluation.
