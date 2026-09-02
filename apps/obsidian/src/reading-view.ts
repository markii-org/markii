import {
  MarkdownRenderChild,
  TFile,
  type CachedMetadata,
  type EmbedCache,
  type LinkCache,
} from 'obsidian';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createValueStore } from '@markii/runtime';
import {
  MARK_EXTENSION,
  readPersistedValues,
  staleValuesForRehydration,
} from '@markii/host';
import type { Registry } from '@markii/react';
import { renderDocument } from './render-document.js';
import {
  createUnresolvedImageReporter,
  createVaultImageResolver,
} from './preview-images.js';
import type { VaultImageResolver } from './preview-images.js';
import { createLocalStorageMemento } from './run/local-storage-memento.js';
import { onValuesChanged } from './run/run-events.js';
import { convertWikilinksToMarkdown } from './reading-view/wikilinks.js';
import type { WikilinkReference } from './reading-view/wikilinks.js';
import { ReadingViewSectionCoordinator } from './reading-view/section-coordinator.js';
import type MarkiiPlugin from './main.js';

/**
 * Wires Obsidian's Reading view to `@markii/react`, so a `.mk.md` note
 * renders its components inline instead of as plain markdown with dangling
 * `:::` fences. Imports `obsidian` (this plugin's file-scope split, see
 * `src/obsidian-import-guard.test.ts`, whose allowlist this file was added
 * to): a markdown post processor and a `MarkdownRenderChild` cannot exist
 * without it, and neither is unit-testable regardless of which file they
 * live in. Every piece worth testing in isolation already lives in a plain
 * module: `./reading-view/wikilinks.ts` (the text surgery),
 * `./reading-view/section-coordinator.ts` (which section renders), and
 * `./render-document.tsx` (the actual `@markii/react` call, shared with the
 * `MarkiiPreviewView` pane).
 *
 * SCOPE. `.mk.md` notes only, matching `MARK_EXTENSION` everywhere else in
 * this plugin, so an ordinary `.md` note is never touched. Live Preview /
 * CM6 (the source-mode editor) is explicitly out of scope: this only
 * affects Reading view, the same split VS Code's preview keeps from the
 * source editor.
 *
 * WHY WHOLE-NOTE, NOT PER-SECTION. Obsidian splits a note into independent
 * top-level sections and calls the registered post processor once per
 * section; a Markii `:::` container can span several of those sections, so
 * rendering each one through `@markii/react` independently would cut a
 * container in half at whatever blank line falls inside it.
 * `ReadingViewSectionCoordinator` decides which section (the first one
 * Obsidian calls this processor for, per render pass) renders the whole
 * note; every later section for the same render pass is left empty.
 */
export function registerReadingView(plugin: MarkiiPlugin): void {
  const coordinator = new ReadingViewSectionCoordinator();

  plugin.registerMarkdownPostProcessor((el, ctx) => {
    if (!plugin.settings.inlineReadingView) return;
    if (!ctx.sourcePath.endsWith(MARK_EXTENSION)) return;

    // `getSectionInfo` can return `null` (Obsidian's own docs: "this
    // function may also return null in many circumstances"), for instance
    // during a hover preview or another non-interactive render pass. This
    // processor never reads the line range it would carry, since the whole
    // note is rendered as one string read fresh from the vault, so a
    // `null` result changes nothing about the logic below; it is called
    // here only so a future change that DOES want the range cannot forget
    // this method needs a null check.
    ctx.getSectionInfo(el);

    if (coordinator.decide(ctx.docId) === 'empty') {
      el.empty();
      return;
    }

    const section = new ReadingViewSection(
      plugin,
      el,
      ctx.sourcePath,
      ctx.docId,
      coordinator,
    );
    ctx.addChild(section);
  });
}

function toWikilinkReference(
  cacheItem: LinkCache | EmbedCache,
  isEmbed: boolean,
): WikilinkReference {
  return {
    link: cacheItem.link,
    ...(cacheItem.displayText !== undefined
      ? { displayText: cacheItem.displayText }
      : {}),
    isEmbed,
    offset: {
      start: cacheItem.position.start.offset,
      end: cacheItem.position.end.offset,
    },
  };
}

/** Every wikilink and embed the metadata cache knows about for this note, in the shape `convertWikilinksToMarkdown` takes. `null` (no cache yet, or a note with neither) becomes an empty list, which makes the conversion a no-op. */
function collectWikilinkReferences(
  cache: CachedMetadata | null,
): WikilinkReference[] {
  if (!cache) return [];
  return [
    ...(cache.links ?? []).map((link) => toWikilinkReference(link, false)),
    ...(cache.embeds ?? []).map((embed) => toWikilinkReference(embed, true)),
  ];
}

/**
 * One claimed section's whole lifecycle: mount a React root into `el` on
 * load, tear it down on unload, and release the coordinator's claim so the
 * NEXT render pass for this note (an edit, for instance, produces a fresh
 * `docId`) can render again.
 */
class ReadingViewSection extends MarkdownRenderChild {
  private root: Root | undefined;
  private unsubscribeValuesChanged: (() => void) | undefined;
  private readonly reportUnresolvedImage = createUnresolvedImageReporter(
    (line) => {
      console.warn(line);
    },
  );

  constructor(
    private readonly plugin: MarkiiPlugin,
    containerEl: HTMLElement,
    private readonly sourcePath: string,
    private readonly docId: string,
    private readonly coordinator: ReadingViewSectionCoordinator,
  ) {
    super(containerEl);
  }

  override onload(): void {
    this.root = createRoot(this.containerEl);
    void this.render();

    // GitHub issue #36 (Reading view rendering): a Run happens through the
    // `MarkiiPreviewView` pane, not here, so this section learns about new
    // values through `run-events.ts` rather than running anything itself.
    this.unsubscribeValuesChanged = onValuesChanged(this.sourcePath, () => {
      void this.render();
    });

    // An edit to the note (including one Obsidian makes on its own, such
    // as a frontmatter update) reaches Reading view as a fresh render pass
    // with a new `docId` in the ordinary case, but `modify` also fires for
    // an external or programmatic write that does not, so this section
    // re-renders on it directly rather than only relying on that.
    this.registerEvent(
      this.plugin.app.vault.on('modify', (file) => {
        if (file instanceof TFile && file.path === this.sourcePath) {
          void this.render();
        }
      }),
    );
  }

  override onunload(): void {
    this.coordinator.release(this.docId);
    this.unsubscribeValuesChanged?.();
    this.unsubscribeValuesChanged = undefined;
    this.root?.unmount();
    this.root = undefined;
  }

  private vaultImageResolver(): VaultImageResolver {
    const app = this.plugin.app;
    const adapter = app.vault.adapter;
    return {
      linkpathDest: (src, from) =>
        app.metadataCache.getFirstLinkpathDest(src, from)?.path,
      vaultPathExists: (vaultPath) =>
        app.vault.getAbstractFileByPath(vaultPath) instanceof TFile,
      resourcePath: (vaultPath) => adapter.getResourcePath(vaultPath),
    };
  }

  private async render(): Promise<void> {
    if (!this.root) return;
    const app = this.plugin.app;
    const file = app.vault.getAbstractFileByPath(this.sourcePath);
    if (!(file instanceof TFile)) return;

    const rawText = await app.vault.cachedRead(file);
    // The section may have unloaded (a fast edit, or switching away from
    // the note) while the read above was in flight.
    if (!this.root) return;

    const references = collectWikilinkReferences(
      app.metadataCache.getFileCache(file),
    );
    const text = convertWikilinksToMarkdown(rawText, references, (link) => {
      const dest = app.metadataCache.getFirstLinkpathDest(
        link,
        this.sourcePath,
      );
      // An unresolved wikilink keeps pointing at its own raw text
      // (`wikilinks.ts`'s own contract) rather than breaking the render.
      return dest ? dest.path : link;
    });

    const memento = createLocalStorageMemento(
      (key) => app.loadLocalStorage(key),
      (key, value) => {
        app.saveLocalStorage(key, value);
      },
    );
    const persisted = readPersistedValues(memento, this.sourcePath);
    const store =
      Object.keys(persisted).length > 0
        ? createValueStore(staleValuesForRehydration(persisted))
        : undefined;

    const registry: Registry = this.plugin.readingViewRegistry();
    const resolveImageSrc = createVaultImageResolver(
      this.sourcePath,
      this.vaultImageResolver(),
      this.reportUnresolvedImage,
    );

    this.root.render(
      createElement(
        'div',
        { className: 'doc', key: this.sourcePath },
        renderDocument(text, store, registry, resolveImageSrc),
      ),
    );
  }
}
