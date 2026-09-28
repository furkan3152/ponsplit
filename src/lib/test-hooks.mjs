// Loaded by `npm test` (node --import). Lets tests import server modules directly, the way the
// Next bundler resolves them: "server-only" is a no-op and extensionless relative imports find
// their .ts file.
import { register } from "node:module";

const hooks = `
export async function resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
  if (/^\\.\\.?\\//.test(specifier) && !/\\.[a-z]+$/i.test(specifier)) return next(specifier + ".ts", context);
  return next(specifier, context);
}`;

register(`data:text/javascript,${encodeURIComponent(hooks)}`);
