import { describe, expect, it } from 'vitest';
import { createTestContext } from '../test/html-context.js';
import { Tab, tabPanel } from './tab.js';

const ctx = createTestContext();

describe('Tab', () => {
  it('renders a role="tabpanel" wrapping its children, matching tabPanel', () => {
    expect(Tab({ label: 'A' }, 'body', ctx)).toBe(tabPanel('body'));
    expect(Tab({}, 'body', ctx)).toBe(
      '<div class="mk-tab" role="tabpanel">body</div>',
    );
  });

  it('ignores the label attribute when rendered standalone', () => {
    expect(Tab({ label: 'Ignored' }, 'x', ctx)).not.toContain('Ignored');
  });
});
