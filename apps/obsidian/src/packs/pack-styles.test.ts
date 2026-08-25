import { describe, expect, it } from 'vitest';
import {
  applyPackStylesheets,
  packStyleElementId,
  removePackStylesheets,
} from './pack-styles.js';
import type { StyleDocument } from './pack-styles.js';

interface FakeElement {
  id: string;
  textContent: string | null;
  removed: boolean;
  remove(): void;
}

function fakeElement(): FakeElement {
  const el: FakeElement = {
    id: '',
    textContent: null,
    removed: false,
    remove() {
      el.removed = true;
    },
  };
  return el;
}

function fakeDocument(): {
  doc: StyleDocument;
  byId: Map<string, FakeElement>;
  appended: FakeElement[];
} {
  const byId = new Map<string, FakeElement>();
  const appended: FakeElement[] = [];
  const doc: StyleDocument = {
    head: {
      appendChild(node: unknown) {
        const el = node as FakeElement;
        appended.push(el);
        byId.set(el.id, el);
      },
    },
    createElement() {
      return fakeElement();
    },
    getElementById(id: string) {
      return byId.get(id) ?? null;
    },
  };
  return { doc, byId, appended };
}

describe('applyPackStylesheets / removePackStylesheets', () => {
  it('appends one <style> element per sheet, in order', () => {
    const { doc, appended } = fakeDocument();
    applyPackStylesheets(doc, [
      { namespace: 'ana', cssText: '.mk-ana-a {}' },
      { namespace: 'gh', cssText: '.mk-gh-b {}' },
    ]);
    expect(appended).toHaveLength(2);
    expect(appended[0]!.id).toBe(packStyleElementId('ana'));
    expect(appended[0]!.textContent).toBe('.mk-ana-a {}');
    expect(appended[1]!.id).toBe(packStyleElementId('gh'));
  });

  it('removePackStylesheets removes exactly the named namespaces', () => {
    const { doc, byId } = fakeDocument();
    applyPackStylesheets(doc, [{ namespace: 'ana', cssText: '.x {}' }]);
    const el = byId.get(packStyleElementId('ana'))!;
    expect(el.removed).toBe(false);

    removePackStylesheets(doc, ['ana']);
    expect(el.removed).toBe(true);
  });

  it('removePackStylesheets on a namespace with no injected element is a no-op', () => {
    const { doc } = fakeDocument();
    expect(() => removePackStylesheets(doc, ['nothing-here'])).not.toThrow();
  });

  it('re-applying a namespace replaces the previous element rather than duplicating it', () => {
    const { doc, appended } = fakeDocument();
    applyPackStylesheets(doc, [{ namespace: 'ana', cssText: 'a {}' }]);
    applyPackStylesheets(doc, [{ namespace: 'ana', cssText: 'b {}' }]);
    expect(appended).toHaveLength(2);
    expect(appended[0]!.removed).toBe(true);
    expect(appended[1]!.removed).toBe(false);
  });
});
