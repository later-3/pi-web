import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "./LoginForm";
import {
  WEB_AUTH_COOKIE,
  getWebAuthConfig,
  sanitizeWebAuthNext,
  verifyWebAuthToken,
} from "@/lib/web-auth";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ next?: string | string[]; expired?: string | string[] }>;
}

export default async function LoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const nextPath = sanitizeWebAuthNext(typeof params.next === "string" ? params.next : "/");
  const config = getWebAuthConfig();

  if (config.state === "disabled") redirect(nextPath);
  if (config.state === "enabled") {
    const cookieStore = await cookies();
    const verification = verifyWebAuthToken(config, cookieStore.get(WEB_AUTH_COOKIE)?.value);
    if (verification.valid) redirect(nextPath);
  }

  return (
    <LoginForm
      nextPath={nextPath}
      expired={params.expired === "1"}
      configurationError={config.state === "misconfigured"}
    />
  );
}
