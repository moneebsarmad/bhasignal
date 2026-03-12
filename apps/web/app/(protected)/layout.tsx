import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { requireSession } from "@/lib/session";

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  const session = requireSession();

  return (
    <AppShell email={session.email} role={session.role}>
      {children}
    </AppShell>
  );
}
