"use client";

import Link from "next/link";
import { RefreshCcw } from "lucide-react";

import { DeepAnalytics } from "@/components/deep-analytics";
import { Button, PageHeader, buttonStyles } from "@/components/ui";

export function ReportsClient() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Analysis"
        title="Deep analytics for discipline trends"
        description="Move beyond raw counts. Compare grades, violations, staff patterns, and current escalation pressure using the stored discipline dataset."
        actions={
          <div className="flex flex-wrap gap-3">
            <Link href="/reports/reconciliation" className={buttonStyles({ variant: "secondary" })}>
              Student reconciliation
            </Link>
            <Button type="button" variant="ghost" disabled>
              <RefreshCcw className="h-4 w-4" />
              Use filters below
            </Button>
          </div>
        }
      />

      <DeepAnalytics />
    </div>
  );
}
