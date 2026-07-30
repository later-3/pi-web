import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { AuthSessionMonitor } from "@/components/AuthSessionMonitor";
import { I18nProvider } from "@/hooks/useI18n";

export default function Home() {
  return (
    <Suspense>
      <AuthSessionMonitor />
      <I18nProvider>
        <AppShell />
      </I18nProvider>
    </Suspense>
  );
}
