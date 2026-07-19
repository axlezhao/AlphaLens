export async function resolve(specifier, context, nextResolve) {
  if (specifier === "cloudflare:workers") return { url: "data:text/javascript,export const env = globalThis.__TEST_CLOUDFLARE_ENV__ ?? {}; export const waitUntil = (promise) => void promise;", shortCircuit: true };
  return nextResolve(specifier, context);
}
