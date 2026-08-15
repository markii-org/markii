import { Fragment } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { toHast } from 'smd-core';
import type { DirectiveAttributes, Registry } from './registry';
import { UnknownDirective } from './components/unknown-directive';

function parseAttributes(json: string | undefined): DirectiveAttributes {
  if (!json) return {};
  try {
    const parsed: unknown = JSON.parse(json);
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return {};
    }
    const result: DirectiveAttributes = {};
    for (const [key, value] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (typeof value === 'string' || value === null || value === undefined) {
        result[key] = value;
      }
    }
    return result;
  } catch {
    return {};
  }
}

interface DirectiveElementProps {
  'data-smd-name'?: string;
  'data-smd-attrs'?: string;
  'data-smd-kind'?: string;
  children?: ReactNode;
}

// hast-util-to-jsx-runtime's `Components` map is keyed by `JSX.IntrinsicElements`
// (see its readme: "Each key is a tag name typed in JSX.IntrinsicElements").
// Registering our marker tag there is the supported way to give it a typed
// `components` entry below, without a cast or `any`.
declare global {
  namespace JSX {
    interface IntrinsicElements {
      'smd-directive': DirectiveElementProps;
    }
  }
}

/**
 * Builds the React component used to replace every `<smd-directive>` hast
 * element (tagged by `smd-core`'s `toHast`): looks the directive name up in
 * `registry`, and renders the matching component with parsed attributes and
 * pre-rendered children — or the neutral fallback box if the name isn't
 * registered. This is the only place a directive name is resolved; it
 * never throws.
 *
 * Typed as a plain function (not React's `ComponentType`, whose declared
 * return type is the broader `ReactNode`) because hast-util-to-jsx-runtime's
 * `Components` map expects a component returning `JSX.Element | string |
 * null | undefined` — narrower than `ReactNode`. This component always
 * returns a `ReactElement`, so the narrower signature is also the honest one.
 */
function createDirectiveElement(
  registry: Registry,
): (props: DirectiveElementProps) => ReactElement {
  return function DirectiveElement(props: DirectiveElementProps): ReactElement {
    const name = props['data-smd-name'] ?? '';
    const kind = props['data-smd-kind'];
    const attributes = parseAttributes(props['data-smd-attrs']);
    // `Object.hasOwn` (rather than `registry[name]` / `name in registry`)
    // guards against a directive named `constructor`, `toString`,
    // `valueOf`, `hasOwnProperty`, etc. resolving through the prototype
    // chain to an inherited `Object.prototype` member instead of falling
    // through to the unknown-directive fallback (Architecture rule 3: unknown
    // directives never throw). The `entry?.component == null` check is a
    // second belt-and-suspenders guard for the same class of bug — it must
    // be a nullish check rather than `typeof ... !== 'function'`, since
    // `React.memo`/`forwardRef`/`lazy` all produce a component whose
    // `typeof` is `'object'`, not `'function'`, and TypeScript's
    // `ComponentType` accepts all of them.
    const entry = Object.hasOwn(registry, name) ? registry[name] : undefined;

    if (entry?.component == null) {
      return (
        <UnknownDirective
          name={name || '(unnamed)'}
          inline={kind === 'textDirective'}
        >
          {props.children}
        </UnknownDirective>
      );
    }

    const Component = entry.component;
    return <Component attributes={attributes}>{props.children}</Component>;
  };
}

/**
 * Renders Super Markdown text to a React element tree using `registry` to
 * resolve directive names. Pipeline: `smd-core`'s `toHast` (parse -> tag
 * directive nodes -> remark-rehype -> sanitize URLs) -> hast-util-to-jsx-runtime
 * (React elements), with directive elements swapped for registry components
 * (or the unknown-directive fallback) along the way. Never throws: parsing
 * is tolerant by construction, and unresolved directive names always render
 * a fallback rather than fail.
 */
export function renderSmd(text: string, registry: Registry): ReactElement {
  try {
    const hastTree = toHast(text);
    const DirectiveElement = createDirectiveElement(registry);
    return toJsxRuntime(hastTree, {
      Fragment,
      jsx,
      jsxs,
      components: { 'smd-directive': DirectiveElement },
    }) as ReactElement;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return (
      <div className="smd-unknown smd-unknown--block" role="alert">
        <p className="smd-unknown__label">failed to render document</p>
        <pre className="smd-unknown__content">{message}</pre>
      </div>
    );
  }
}
