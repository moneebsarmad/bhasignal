import { requireRole } from "@/lib/session";
import { NotificationsClient } from "./NotificationsClient";

export default function NotificationsPage() {
  requireRole(["admin"]);

  return <NotificationsClient />;
}
