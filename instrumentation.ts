export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ assertQfRuntimeIdentity, loadQfRuntimeEnvironment }, { startQfObservability }] =
    await Promise.all([
      import("./lib/runtime/deploymentConfig"),
      import("./lib/observability/runtime"),
    ]);
  loadQfRuntimeEnvironment();
  try {
    const identity = assertQfRuntimeIdentity("quickfurno.web");
    startQfObservability(identity);
  } catch {
    // Deployment identity remains authoritative. Next build/edge tooling may import this file
    // without the production runtime identity; observability must never create business authority.
  }
}
