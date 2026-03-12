import { requireSession } from "@/lib/session";

import { DashboardClient } from "./DashboardClient";

export default function DashboardPage() {
  const session = requireSession();
  return <DashboardClient canManageSycamore={session.role === "admin"} />;
}
