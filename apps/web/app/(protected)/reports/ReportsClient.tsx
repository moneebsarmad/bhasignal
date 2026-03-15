"use client";

import Link from "next/link";

import { DeepAnalytics } from "@/components/deep-analytics";
import { PageHeader, buttonStyles } from "@/components/ui";

export function ReportsClient() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analysis"
        title="Deep analytics for discipline trends"
        description="Move beyond raw counts. Compare grades, violations, staff patterns, and current escalation pressure using the stored discipline dataset."
        actions={
          <Link href="/reports/reconciliation" className={buttonStyles({ variant: "secondary" })}>
            Student reconciliation
          </Link>
        }
      />

      <DeepAnalytics />
    </div>
  );
}
