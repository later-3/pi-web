import { Suspense } from "react";
import { DeviceWorkspaceRoot } from "@/components/DeviceWorkspaceRoot";
import { AuthSessionMonitor } from "@/components/AuthSessionMonitor";
import { I18nProvider } from "@/hooks/useI18n";

export default function Home() {
  return (
    <Suspense>
      <AuthSessionMonitor />
      <I18nProvider>
        <DeviceWorkspaceRoot />
      </I18nProvider>
    </Suspense>
  );
}
