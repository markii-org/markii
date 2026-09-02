/**
 * A helper module that is NOT declared as a component in `pack.json` and is
 * not the compiler's entry: `Stat.tsx` imports it and renders it. It uses
 * JSX itself (`<span>...</span>`), which is exactly the shape that shipped
 * broken with a `banner`-based JSX shim (`__markiiJSX is not defined` at
 * render time, because a `banner`'s text lands outside the IIFE the bundler
 * scopes a module-level `var` to, and this module is not the entry module
 * that `var` would have been visible in anyway).
 */
export function Badge({ label }: { label: string }) {
  return <span className="mk-tsxjsxhelper_badge">{label}</span>;
}
