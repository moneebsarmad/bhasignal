import { requireRole } from "@/lib/session";
import { PoliciesClient } from "./PoliciesClient";

export default function PoliciesPage() {
  requireRole(["admin"]);

  return <PoliciesClient />;
}
