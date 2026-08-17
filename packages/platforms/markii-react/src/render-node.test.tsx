import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { parse } from '@markii/core';
import type { MarkNode } from '@markii/core';
import { createValueStore, createVaultStore } from '@markii/runtime';
import { renderMark, renderMarkNode } from './render';
import { defaultRegistry } from './components';
import type { Registry, MarkComponentProps } from './registry';

/**
 * Every node shape `renderMarkNode` must render identically to how
 * `renderMark` renders it in-document: prose (heading/paragraph/blockquote/
 * list), GFM constructs (table, task list), every directive shape
 * (container, leaf, and — inside the paragraph below — text), a folded
 * script marker, an *open* script marker, and a plain (non-script) code
 * fence.
 */
const DOCUMENT = [
  '# Heading',
  '',
  'A plain paragraph with a [link](https://example.com).',
  '',
  '> A blockquote.',
  '',
  '- item one',
  '- item two',
  '',
  // A different bullet marker (`*` vs `-`) forces CommonMark to start a new
  // list here rather than continuing the one above as a single loose list.
  '* [x] done',
  '* [ ] not done',
  '',
  '| Name | Role     |',
  '| ---- | -------- |',
  '| Ada  | Engineer |',
  '',
  ':::callout{type=warning title="Careful"}',
  'Inside a container directive.',
  ':::',
  '',
  '::rating{value=3 max=5}',
  '',
  'Text with :kbd[Ctrl+S] inline directive.',
  '',
  '```lua {name=stars}',
  'return 1',
  '```',
  '',
  '```lua {name=stars2 open}',
  'return 2',
  '```',
  '',
  '```lua',
  'print("hi")',
  '```',
].join('\n');

/**
 * Hostile top-level nodes that must degrade IDENTICALLY whether rendered
 * standalone via `renderMarkNode` or in-document via `renderMark`: a
 * directive named `constructor`/`toString` (Object.prototype collisions
 * reachable through actual directive syntax — `__proto__` is NOT reachable
 * this way, since a leading `_` is not a valid directive-name start
 * character and `__proto__` itself parses as CommonMark strong emphasis; see
 * the dedicated AST-level test below for that one), an unregistered
 * directive (dashed fallback box), a code fence whose `name` is
 * charset-invalid (stays plain code, never a script marker), and a
 * paragraph carrying `javascript:`/`data:text/html` URLs.
 */
const HOSTILE_DOCUMENT = [
  '::constructor',
  '',
  ':::toString',
  'Container named toString.',
  ':::',
  '',
  'Inline collision: :hasOwnProperty[x] should also show a fallback.',
  '',
  '::sparkle{color=purple}',
  '',
  '```lua {name=repo.stars}',
  'return 1',
  '```',
  '',
  'A [bad link](javascript:alert(1)) and an image ![bad](data:text/html,evil).',
].join('\n');

/** Top-level rendered elements of a rendered document, in order (skips whitespace-only text between them). */
function topLevelElements(container: HTMLElement): Element[] {
  return Array.from(container.children);
}

function parseTopLevel(text: string): MarkNode[] {
  return parse(text).children;
}

describe('renderMarkNode: parity with renderMark (in-document)', () => {
  it('renders every top-level node identically standalone and in-document', () => {
    const { container: wholeDoc } = render(
      renderMark(DOCUMENT, defaultRegistry),
    );
    const wholeDocElements = topLevelElements(wholeDoc);
    const nodes = parseTopLevel(DOCUMENT);

    expect(nodes.length).toBe(wholeDocElements.length);

    nodes.forEach((node, index) => {
      const { container: standalone } = render(
        renderMarkNode(node, defaultRegistry),
      );
      const standaloneElements = topLevelElements(standalone);
      expect(standaloneElements).toHaveLength(1);
      expect(standaloneElements[0]?.outerHTML).toBe(
        wholeDocElements[index]?.outerHTML,
      );
    });
  });

  it('renders the container directive, leaf directive, and text directive with the correct registry components', () => {
    const nodes = parseTopLevel(DOCUMENT);
    // heading, paragraph, blockquote, list, task list, table, callout, rating, kbd-paragraph, ...
    const calloutNode = nodes[6]!;
    const ratingNode = nodes[7]!;
    const kbdParagraphNode = nodes[8]!;

    const { container: calloutContainer } = render(
      renderMarkNode(calloutNode, defaultRegistry),
    );
    expect(
      calloutContainer.querySelector('.mk-callout--warning'),
    ).not.toBeNull();

    const { container: ratingContainer } = render(
      renderMarkNode(ratingNode, defaultRegistry),
    );
    expect(
      ratingContainer.querySelector('[role="img"].mk-rating'),
    ).not.toBeNull();

    const { container: kbdContainer } = render(
      renderMarkNode(kbdParagraphNode, defaultRegistry),
    );
    expect(kbdContainer.querySelector('kbd.mk-kbd')).toHaveTextContent(
      'Ctrl+S',
    );
  });

  it('renders a folded script marker and an open one, matching in-document output', () => {
    const nodes = parseTopLevel(DOCUMENT);
    const foldedNode = nodes[9]!;
    const openNode = nodes[10]!;
    const plainCodeNode = nodes[11]!;

    const { container: foldedContainer } = render(
      renderMarkNode(foldedNode, defaultRegistry),
    );
    const foldedMarker = foldedContainer.querySelector('details.mk-script');
    expect(foldedMarker).not.toBeNull();
    expect(foldedMarker).not.toHaveAttribute('open');

    const { container: openContainer } = render(
      renderMarkNode(openNode, defaultRegistry),
    );
    const openMarker = openContainer.querySelector('details.mk-script');
    expect(openMarker).not.toBeNull();
    expect(openMarker).toHaveAttribute('open');

    const { container: plainContainer } = render(
      renderMarkNode(plainCodeNode, defaultRegistry),
    );
    expect(plainContainer.querySelector('.mk-script')).toBeNull();
    expect(plainContainer.querySelector('pre code')).not.toBeNull();
  });
});

describe('renderMarkNode: hostile cases degrade identically standalone vs in-document', () => {
  it('renders every hostile top-level node identically standalone and in-document', () => {
    const { container: wholeDoc } = render(
      renderMark(HOSTILE_DOCUMENT, defaultRegistry),
    );
    const wholeDocElements = topLevelElements(wholeDoc);
    const nodes = parseTopLevel(HOSTILE_DOCUMENT);

    expect(nodes.length).toBe(wholeDocElements.length);

    nodes.forEach((node, index) => {
      const { container: standalone } = render(
        renderMarkNode(node, defaultRegistry),
      );
      const standaloneElements = topLevelElements(standalone);
      expect(standaloneElements).toHaveLength(1);
      expect(standaloneElements[0]?.outerHTML).toBe(
        wholeDocElements[index]?.outerHTML,
      );
    });
  });

  it('renders the unknown-directive fallback for constructor/toString/hasOwnProperty, standalone', () => {
    const nodes = parseTopLevel(HOSTILE_DOCUMENT);
    const [constructorNode, toStringNode, hasOwnPropertyParagraph] = nodes;

    for (const node of [
      constructorNode!,
      toStringNode!,
      hasOwnPropertyParagraph!,
    ]) {
      const { container } = render(renderMarkNode(node, defaultRegistry));
      expect(container.querySelector('.mk-unknown')).not.toBeNull();
    }
  });

  it('renders the unknown-directive fallback for a directive node named __proto__, standalone (constructed at the AST level: `__proto__` cannot be written as directive syntax at all — see the doc comment above HOSTILE_DOCUMENT)', () => {
    const protoNode: MarkNode = {
      type: 'leafDirective',
      name: '__proto__',
      attributes: {},
      children: [],
    };

    expect(() =>
      render(renderMarkNode(protoNode, defaultRegistry)),
    ).not.toThrow();
    const { container } = render(renderMarkNode(protoNode, defaultRegistry));
    expect(container.querySelector('.mk-unknown')).not.toBeNull();
  });

  it('renders the dashed fallback box for an unregistered directive, standalone', () => {
    const nodes = parseTopLevel(HOSTILE_DOCUMENT);
    const sparkleNode = nodes[3]!;
    const { container } = render(renderMarkNode(sparkleNode, defaultRegistry));
    const fallback = container.querySelector('.mk-unknown');
    expect(fallback).not.toBeNull();
    expect(fallback).toHaveTextContent('sparkle');
  });

  it('leaves a charset-invalid script name as plain code, not a script marker, standalone', () => {
    const nodes = parseTopLevel(HOSTILE_DOCUMENT);
    const invalidNameCodeNode = nodes[4]!;
    const { container } = render(
      renderMarkNode(invalidNameCodeNode, defaultRegistry),
    );
    expect(container.querySelector('.mk-script')).toBeNull();
    const code = container.querySelector('pre code');
    expect(code).not.toBeNull();
    expect(code?.textContent).toBe('return 1\n');
  });

  it('strips javascript: and data:text/html URLs the same way, standalone', () => {
    const nodes = parseTopLevel(HOSTILE_DOCUMENT);
    const hostileUrlParagraph = nodes[5]!;
    const { container } = render(
      renderMarkNode(hostileUrlParagraph, defaultRegistry),
    );
    const link = container.querySelector('a');
    expect(link).not.toBeNull();
    expect(link).not.toHaveAttribute('href');
    const image = container.querySelector('img');
    expect(image).not.toBeNull();
    expect(image).not.toHaveAttribute('src');
  });
});

describe('renderMarkNode: bare-only `open` (docs/scripting.md)', () => {
  it('opens for a genuinely bare `open` attribute', () => {
    const [node] = parseTopLevel('```lua {name=x open}\nreturn 1\n```');
    const { container } = render(renderMarkNode(node!, defaultRegistry));
    expect(container.querySelector('details.mk-script')).toHaveAttribute(
      'open',
    );
  });

  it.each(['true', 'false', ''])(
    'does NOT open for `open=%s` (a valued spelling, fail closed)',
    (value) => {
      const meta = value === '' ? 'open=""' : `open=${value}`;
      const [node] = parseTopLevel(
        `\`\`\`lua {name=x ${meta}}\nreturn 1\n\`\`\``,
      );
      const { container } = render(renderMarkNode(node!, defaultRegistry));
      expect(container.querySelector('details.mk-script')).not.toHaveAttribute(
        'open',
      );
    },
  );

  it('does NOT open when `open` is absent entirely', () => {
    const [node] = parseTopLevel('```lua {name=x}\nreturn 1\n```');
    const { container } = render(renderMarkNode(node!, defaultRegistry));
    expect(container.querySelector('details.mk-script')).not.toHaveAttribute(
      'open',
    );
  });

  it('matches renderMark for every spelling (no drift between the two entry points)', () => {
    for (const meta of ['open', 'open=true', 'open=false', 'open=""', '']) {
      const text = `\`\`\`lua {name=x ${meta}}\nreturn 1\n\`\`\``;
      const [node] = parseTopLevel(text);
      const { container: nodeContainer } = render(
        renderMarkNode(node!, defaultRegistry),
      );
      const { container: markContainer } = render(
        renderMark(text, defaultRegistry),
      );
      expect(
        nodeContainer.querySelector('details.mk-script')?.hasAttribute('open'),
      ).toBe(
        markContainer.querySelector('details.mk-script')?.hasAttribute('open'),
      );
    }
  });
});

describe('renderMarkNode: same value/vault resolution contract as renderMark', () => {
  function probeRegistry(): {
    registry: Registry;
    seen: () => MarkComponentProps | undefined;
  } {
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
    return { registry, seen: () => seen };
  }

  it('resolves data=name against the passed store, same as renderMark', () => {
    const store = createValueStore({
      stars: { value: 42, status: 'fresh', ranAt: 1000 },
    });
    const { registry, seen } = probeRegistry();
    const [node] = parseTopLevel('::probe{data=stars}');

    render(renderMarkNode(node!, registry, store));

    expect(seen()?.data).toBe(42);
    expect(seen()?.dataStatus).toBe('fresh');
  });

  it('resolves an @-prefixed name against the passed vault, same as renderMark', () => {
    const vault = createVaultStore({
      initial: { gh: { value: { stars: 7 }, status: 'fresh', ranAt: 1000 } },
    }).store;
    const { registry, seen } = probeRegistry();
    const [node] = parseTopLevel('::probe{data=@gh.stars}');

    render(renderMarkNode(node!, registry, undefined, vault));

    expect(seen()?.data).toBe(7);
    expect(seen()?.dataStatus).toBe('fresh');
  });

  it('renders :value[name] the same way as renderMark, including the missing-value marker with no store', () => {
    const [node] = parseTopLevel(':value[stars]');
    const { container } = render(renderMarkNode(node!, defaultRegistry));
    expect(container.querySelector('.mk-value--missing')).not.toBeNull();
  });
});

describe('renderMarkNode: purity and never-throw', () => {
  it('is a pure function: rendering the same node twice yields the same output', () => {
    const [node] = parseTopLevel('::rating{value=3 max=5}');
    const { container: first } = render(renderMarkNode(node!, defaultRegistry));
    const { container: second } = render(
      renderMarkNode(node!, defaultRegistry),
    );
    expect(first.innerHTML).toBe(second.innerHTML);
  });

  it('never throws for a directive name colliding with an inherited Object.prototype member', () => {
    const [node] = parseTopLevel(':::constructor\nhi\n:::');
    expect(() => render(renderMarkNode(node!, {}))).not.toThrow();
    const { container } = render(renderMarkNode(node!, {}));
    expect(container.querySelector('.mk-unknown')).not.toBeNull();
  });
});

describe('renderMarkNode — caller-supplied hast overrides cannot reach the DOM', () => {
  it('renders a data.hName="script" tampered node as ordinary content', () => {
    const [paragraph] = parseTopLevel('hello world');
    const tampered = {
      ...paragraph,
      data: { hName: 'script', hProperties: { src: 'javascript:alert(1)' } },
    } as MarkNode;

    const { container } = render(renderMarkNode(tampered, defaultRegistry));

    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toContain('javascript:');
    expect(container.textContent).toContain('hello world');
    // Identical to the untampered node's rendering.
    const clean = render(renderMarkNode(paragraph!, defaultRegistry));
    expect(container.innerHTML).toBe(clean.container.innerHTML);
  });

  it('renders a data.hChildren tampered node without splicing in the hostile element', () => {
    const [paragraph] = parseTopLevel('hello world');
    const tampered = {
      ...paragraph,
      data: {
        hChildren: [
          {
            type: 'element',
            tagName: 'iframe',
            properties: { src: 'javascript:alert(2)' },
            children: [],
          },
        ],
      },
    } as MarkNode;

    const { container } = render(renderMarkNode(tampered, defaultRegistry));

    expect(container.querySelector('iframe')).toBeNull();
    expect(container.innerHTML).not.toContain('javascript:');
    expect(container.textContent).toContain('hello world');
  });
});
