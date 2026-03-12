import { requireRole } from "@/lib/session";

import { DataOpsClient } from "./DataOpsClient";

export default function DataOpsPage() {
  requireRole(["admin"]);

  return <DataOpsClient />;
}
