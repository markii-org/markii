import { describe, expect, it } from 'vitest';
import { escapeHtml } from '../escape.js';
import { Details } from './details.js';

const ctx = { esc: escapeHtml };

describe('Details', () => {
  it('defaults the summary to "Details" and starts folded', () => {
    const html = Details({}, 'body', ctx);
    expect(html).toContain(
      '<summary class="mk-details__summary">Details</summary>',
    );
    expect(html).not.toContain(' open');
  });

  it('uses the given title', () => {
    const html = Details({ title: 'More' }, 'body', ctx);
    expect(html).toContain(
      '<summary class="mk-details__summary">More</summary>',
    );
  });

  it('starts open when the bare `open` attribute is present', () => {
    const html = Details({ open: null }, 'body', ctx);
    expect(html).toContain('<details class="mk-details" open>');
  });

  it('escapes the title', () => {
    const html = Details({ title: '<x>' }, 'body', ctx);
    expect(html).toContain('&lt;x&gt;');
  });

  it('wraps the body in mk-details__body', () => {
    expect(Details({}, 'hi', ctx)).toContain(
      '<div class="mk-details__body">hi</div>',
    );
  });
});
