/** Node-only startup work lives in a separate file so the Edge bundle never sees it. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { verifyBoot } = await import('./instrumentation-node');
    verifyBoot();
  }
}
