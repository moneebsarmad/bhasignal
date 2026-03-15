"use client";

import { DeepAnalytics } from "@/components/deep-analytics";
import { PageHeader } from "@/components/ui";

export function ReportsClient() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analysis"
        title="Deep analytics for discipline trends"
        description="Move beyond raw counts. Compare grades, violations, staff patterns, and current escalation pressure using the Sycamore-synced discipline dataset."
      />

      <DeepAnalytics />
    </div>
  );
}
