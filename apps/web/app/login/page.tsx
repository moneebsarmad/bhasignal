import { redirect } from "next/navigation";

import { LoginForm } from "@/app/login/LoginForm";
import { getCurrentSession } from "@/lib/session";

export default function LoginPage() {
  const session = getCurrentSession();
  if (session) {
    redirect("/dashboard");
  }
  return <LoginForm />;
}

