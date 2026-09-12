import { describe, expect, it } from 'vitest';
import {
  createRenderDiagnosticCollector,
  createRenderDiagnosticReporter,
  renderDiagnosticLine,
} from './render-diagnostics.js';

describe('renderDiagnosticLine', () => {
  it('names the directive and the attribute when both are known', () => {
    expect(
      renderDiagnosticLine({
        kind: 'invalid-attribute-value',
        directive: 'card',
        attribute: 'text',
        message: 'text="Hey" is not one of left, center, right',
      }),
    ).toBe(
      'Render in card\'s text: text="Hey" is not one of left, center, right',
    );
  });

  it('names the directive alone when there is no single attribute', () => {
    expect(
      renderDiagnosticLine({
        kind: 'unsafe-image-src',
        directive: 'figure',
        message: 'the image source was refused',
      }),
    ).toBe('Render in figure: the image source was refused');
  });

  it('still produces a line when the event names nothing', () => {
    expect(
      renderDiagnosticLine({
        kind: 'invalid-attribute-value',
        message: 'something was declined',
      }),
    ).toBe('Render: something was declined');
  });
});

describe('createRenderDiagnosticReporter', () => {
  it('writes each distinct line once, however often the render repeats', () => {
    const lines: string[] = [];
    const report = createRenderDiagnosticReporter((line) => lines.push(line));
    const event = {
      kind: 'invalid-attribute-value' as const,
      directive: 'card',
      attribute: 'text',
      message: 'not in the enum',
    };
    report(event);
    report(event);
    report({ ...event, directive: 'callout' });
    expect(lines).toEqual([
      "Render in card's text: not in the enum",
      "Render in callout's text: not in the enum",
    ]);
  });
});

describe('createRenderDiagnosticCollector', () => {
  it('holds the deduped lines for a host that reports after the render', () => {
    const collector = createRenderDiagnosticCollector();
    collector.onDiagnostic({
      kind: 'unsafe-image-src',
      directive: 'figure',
      message: 'refused',
    });
    collector.onDiagnostic({
      kind: 'unsafe-image-src',
      directive: 'figure',
      message: 'refused',
    });
    expect(collector.lines()).toEqual(['Render in figure: refused']);
  });

  it('hands back a copy, so a caller cannot mutate what was collected', () => {
    const collector = createRenderDiagnosticCollector();
    collector.lines().push('injected');
    expect(collector.lines()).toEqual([]);
  });
});
