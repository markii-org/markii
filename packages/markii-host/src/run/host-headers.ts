/**
 * Request headers a HOST sets for an allowed origin, such as an
 * `Authorization` token for one API.
 *
 * This module is environment-neutral: the check that a header name or value
 * is acceptable to the platform's own HTTP stack is injected, so the Node
 * provider passes `node:http`'s validators and the browser provider passes
 * the `Headers` constructor. Three rules hold wherever the headers are used,
 * and each has a test:
 *
 * - they attach only when a request's origin equals the key exactly, on
 *   every redirect hop (`net-provider.ts`);
 * - they never reach the isolate that runs Lua, because the provider that
 *   adds them runs on the host side of the net bridge;
 * - they attach to GET only.
 */

/** Header names by origin, as a host writes them: `{ 'https://api.github.com': { authorization: 'Bearer ...' } }`. */
export type HostHeaders = Readonly<
  Record<string, Readonly<Record<string, string>>>
>;

/** The validated form: origin to lower-cased header name to value. */
export type NormalizedHostHeaders = ReadonlyMap<
  string,
  Readonly<Record<string, string>>
>;

/** A host header may not replace the framing headers the provider sets itself. */
const REFUSED_NAMES: ReadonlySet<string> = new Set([
  'host',
  'content-length',
  'content-type',
  'transfer-encoding',
  'connection',
]);

/** Throws when the platform's HTTP stack would reject this header. */
export type HeaderValidator = (name: string, value: string) => void;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Validates `headers` and returns them keyed by normalized origin with
 * lower-cased names. Throws on the first problem, naming the origin and the
 * header, so a mistake surfaces when the host is constructed and never in
 * the middle of a run.
 */
export function normalizeHostHeaders(
  headers: HostHeaders | undefined,
  validate: HeaderValidator,
): NormalizedHostHeaders {
  const result = new Map<string, Readonly<Record<string, string>>>();
  if (headers === undefined) return result;
  for (const [key, entries] of Object.entries(headers)) {
    let url: URL;
    try {
      url = new URL(key);
    } catch {
      throw new Error(
        `headers: "${key}" is not an origin such as https://host`,
      );
    }
    const bare =
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username === '' &&
      url.password === '' &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === '';
    if (!bare) {
      throw new Error(
        `headers: "${key}" must be a bare http or https origin such as https://host`,
      );
    }
    if (result.has(url.origin)) {
      throw new Error(`headers: origin "${url.origin}" is listed twice`);
    }
    const normalized: Record<string, string> = {};
    for (const [rawName, value] of Object.entries(entries)) {
      const name = rawName.toLowerCase();
      if (REFUSED_NAMES.has(name)) {
        throw new Error(
          `headers: "${name}" for ${url.origin} is set by the provider and cannot be overridden`,
        );
      }
      if (typeof value !== 'string') {
        throw new Error(
          `headers: "${name}" for ${url.origin} must be a string`,
        );
      }
      if (/[\r\n]/.test(name) || /[\r\n]/.test(value)) {
        throw new Error(
          `headers: "${name}" for ${url.origin} contains a line break`,
        );
      }
      if (name in normalized) {
        throw new Error(`headers: "${name}" for ${url.origin} is listed twice`);
      }
      try {
        validate(name, value);
      } catch (error) {
        throw new Error(
          `headers: "${name}" for ${url.origin} is not a valid header: ${describe(error)}`,
        );
      }
      normalized[name] = value;
    }
    result.set(url.origin, normalized);
  }
  return result;
}
