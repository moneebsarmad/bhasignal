export default function ReconciliationPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[var(--color-primary)]">Legacy</p>
        <h1 className="font-display text-4xl text-[var(--color-ink)]">Reconciliation retired</h1>
        <p className="max-w-2xl text-sm leading-7 text-[var(--color-muted)]">
          Signal now treats Sycamore sync as the active source of truth for discipline events. The PDF reconciliation
          workflow is no longer part of the primary product path.
        </p>
      </div>
      <div className="rounded-[1.5rem] border border-[var(--color-line)] bg-[var(--color-panel)] p-6 text-sm leading-7 text-[var(--color-muted)]">
        Use the main analytics, student profiles, and data-ops screens to validate current Sycamore coverage and sync
        health.
      </div>
    </div>
  );
}
