export default function ReviewPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Legacy</p>
        <h1 className="font-display text-4xl text-[var(--color-ink)]">Review queue retired</h1>
        <p className="max-w-2xl text-sm leading-7 text-[var(--color-muted)]">
          Signal now runs on Sycamore-synced discipline data. PDF parsing and manual review are no longer part of the
          active intake workflow.
        </p>
      </div>
      <div className="rounded-[1.5rem] border border-[var(--color-line)] bg-[var(--color-panel)] p-6 text-sm leading-7 text-[var(--color-muted)]">
        Historical review data is still present in storage, but current operations should use Sycamore syncs, student
        profiles, policies, notifications, and analytics.
      </div>
    </div>
  );
}
