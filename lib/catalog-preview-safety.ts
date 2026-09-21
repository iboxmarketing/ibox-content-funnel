export type CatalogSideEffectPorts = {
  taskWriter: () => unknown;
  migrationWriter: () => unknown;
  notificationWriter: () => unknown;
  scheduleWriter: () => unknown;
  publishWriter: () => unknown;
  adsWriter: () => unknown;
  llmCaller?: () => unknown;
  analyticsWriter?: () => unknown;
  codeExecutor?: () => unknown;
  arbitraryUrlFetcher?: () => unknown;
};

/**
 * Server-side boundary for CO-S2. Request flags are deliberately ignored and
 * no side-effect port is invoked, even when a client tries dryRun=false/apply.
 */
export function rejectCatalogPreviewMutation(
  _untrustedRequest: unknown,
  _sideEffectPorts?: CatalogSideEffectPorts,
) {
  void _untrustedRequest;
  void _sideEffectPorts;
  return {
    status: 503 as const,
    body: {
      error: "CO-S2 faqat preview. Task, migration, notification, schedule, publish va ads writerlari ulanmagan.",
      code: "CO_S2_PREVIEW_ONLY" as const,
    },
  };
}
