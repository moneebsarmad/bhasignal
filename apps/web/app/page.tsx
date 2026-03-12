import { redirect } from "next/navigation";

import { getCurrentSession } from "@/lib/session";

export default function HomePage() {
  const session = getCurrentSession();
  redirect(session ? "/dashboard" : "/login");
}
