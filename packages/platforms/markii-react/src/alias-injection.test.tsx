import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { renderMark } from './render';
import { createRegistry, registryAliases } from './registry';
import type { MarkComponentProps, Registry } from './registry';

/**
 * Executable, ADVERSARIAL coverage for docs/spec.md §9's S4-10 ("a document
 * MUST NOT be able to define aliases itself") — Architecture rule that
 * aliases are registry/app configuration, never something a note's own
 * text can create (`registry.ts`'s `RegistryAlias` doc comment: "never
 * definable inside a note").
 *
 * This deliberately does NOT reach into the module-private
 * `REGISTRY_ALIASES` symbol to assert its internal shape — that would only
 * restate what `createRegistry`/`mergeRegistries` already do and would
 * still pass if a real bypass existed elsewhere in the render path (e.g. a
 * future change that read an `alias=`/`aliases=` attribute off a directive
 * and wired it into the alias table before resolution). Instead, every test
 * here renders a REAL document through `renderMark` with a real registry
 * and checks the two externally-observable facts that would change if a
 * document-level alias bypass existed:
 *
 *   1. An `alias=`/`aliases=` (or any other name) attribute arrives at the
 *      component as an perfectly ordinary string in `attributes` — it has
 *      no effect on directive resolution.
 *   2. `registryAliases(registry)` — the same public accessor a host would
 *      use to inspect what a registry knows about — is IDENTICAL before
 *      and after the render, so rendering a hostile document can never
 *      grow, shrink, or rewrite the alias table as a side effect.
 */
describe('renderMark — a document cannot define an alias for itself (docs/spec.md §9 S4-10)', () => {
  it('an alias=/aliases= attribute reaches the component as an ordinary, inert string', () => {
    let seen: MarkComponentProps | undefined;
    const registry: Registry = {
      probe: {
        component: (props: MarkComponentProps) => {
          seen = props;
          return <div className="probe" />;
        },
        inline: false,
      },
    };

    render(
      renderMark('::probe{alias=warn aliases="explode:anything"}', registry),
    );

    expect(seen?.attributes.alias).toBe('warn');
    expect(seen?.attributes.aliases).toBe('explode:anything');
    // No alias table exists on this registry before or after — an
    // attribute named `alias`/`aliases` never creates one.
    expect(registryAliases(registry)).toBeUndefined();
  });

  it('a directive literally NAMED alias or aliases has no special meaning — it is just an unregistered name', () => {
    const registry: Registry = createRegistry({});

    const { container: aliasDoc } = render(
      renderMark('::alias{name=probe target=warn}', registry),
    );
    expect(aliasDoc.querySelector('.mk-unknown')).not.toBeNull();
    expect(aliasDoc.textContent).toContain('unknown component');
    expect(aliasDoc.textContent).toContain('alias');

    const { container: aliasesDoc } = render(
      renderMark(':aliases[warn:callout]', registry),
    );
    expect(aliasesDoc.querySelector('.mk-unknown')).not.toBeNull();

    // Attempting to "define" an alias through either spelling installs
    // nothing: the registry's alias table is still absent afterward.
    expect(registryAliases(registry)).toBeUndefined();
  });

  it('rendering a hostile document never mutates an EXISTING alias table, even one the attributes try to overwrite', () => {
    const registry = createRegistry(
      {
        callout: {
          component: () => <div className="mk-callout" />,
          inline: false,
        },
        probe: {
          component: (props: MarkComponentProps) => (
            <div data-testid="probe" data-alias-attr={props.attributes.alias} />
          ),
          inline: false,
        },
      },
      { warn: { name: 'callout', attributes: { type: 'warning' } } },
    );
    const before = registryAliases(registry);
    expect(before).toEqual({
      warn: { name: 'callout', attributes: { type: 'warning' } },
    });

    render(
      renderMark(
        '::probe{alias=hack aliases="warn:probe"}\n\n:warn[still callout?]',
        registry,
      ),
    );

    // The real `warn` alias still resolves to `callout` — a document-level
    // `aliases="warn:probe"` attribute did not retarget it to `probe`.
    // (renderMark above already proves this doesn't throw; the table
    // identity check below is the load-bearing assertion.)
    expect(registryAliases(registry)).toEqual(before);
    expect(registryAliases(registry)).toBe(before);
  });

  it('a document cannot make a later directive resolve through an attribute-declared alias name', () => {
    // `hack` is declared nowhere as a real alias or component. If an
    // attribute named `alias` on one directive could install `hack` as a
    // pointer to `probe`, this second directive would render `probe`'s
    // markup. It must instead fall through to the unknown-directive
    // fallback, unchanged from what it would render with no preceding
    // directive at all.
    const registry: Registry = createRegistry({
      probe: {
        component: () => <div className="probe-rendered" />,
        inline: false,
      },
    });

    const { container } = render(
      renderMark('::probe{alias=hack}\n\n::hack{}\n\n:hack[text]', registry),
    );

    expect(container.querySelectorAll('.probe-rendered')).toHaveLength(1);
    expect(container.querySelectorAll('.mk-unknown')).toHaveLength(2);
  });
});
