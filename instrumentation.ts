export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertPiSourceRuntime } = await import("@/lib/pi-source-runtime");
  assertPiSourceRuntime();
  const { configureHttpDispatcher } = await import("@/lib/http-dispatcher");
  configureHttpDispatcher();
}
