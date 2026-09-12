import { describe, expect, it } from 'vitest';
import { reportDiagnostic, type DiagnosticEvent } from './diagnostics.js';

const EVENT: DiagnosticEvent = {
  kind: 'invalid-attribute-value',
  directive: 'card',
  attribute: 'text',
  message: 'card: "Hey" is not a valid text value (ignored)',
};

describe('reportDiagnostic', () => {
  it('does nothing when no callback is supplied', () => {
    expect(() => reportDiagnostic(undefined, EVENT)).not.toThrow();
  });

  it('calls the callback with the event unchanged', () => {
    const received: DiagnosticEvent[] = [];
    reportDiagnostic((event) => received.push(event), EVENT);
    expect(received).toEqual([EVENT]);
  });

  it('never throws when the callback itself throws', () => {
    expect(() =>
      reportDiagnostic(() => {
        throw new Error('host callback exploded');
      }, EVENT),
    ).not.toThrow();
  });
});
