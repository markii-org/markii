import { formatValue } from '@markii/stdlib';
import { safeRead } from '../resolve.js';
import { dataStateSuffix, failureToken } from '../failure-presentation.js';
import type { AnsiComponent } from '../registry.js';

const EMPTY_VALUE = '—';

type Trend = 'up' | 'down' | 'flat';
const TRENDS: readonly Trend[] = ['up', 'down', 'flat'];
function isTrend(value: string): value is Trend {
  return (TRENDS as readonly string[]).includes(value);
}

/** A `data=` object's recognized fields (§8), read defensively. */
interface StatFields {
  value?: string;
  label?: string;
  delta?: string;
  trend?: string;
}

function coerceField(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

function readStatFields(data: unknown): StatFields {
  if (typeof data === 'number' || typeof data === 'string') {
    return { value: String(data) };
  }
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    const record = data as Record<string, unknown>;
    return {
      value: coerceField(record.value),
      label: coerceField(record.label),
      delta: coerceField(record.delta),
      trend: coerceField(record.trend),
    };
  }
  return {};
}

/** Explicit directive attributes win over the bound `data` object's own fields. */
function pick(
  attribute: string | null | undefined,
  fromData: string | undefined,
): string | undefined {
  return attribute ?? fromData ?? undefined;
}

/**
 * `::stat{value=42 label="stars" trend=up}` — a big value plus label. Data
 * binding (§8) mirrors `@markii/html`'s `Stat` exactly: a bound number/string
 * supplies `value`; a bound object may supply `value`/`label`/`delta`/`trend`
 * — an explicit attribute always wins. Missing value renders `—` rather than
 * a blank line. Terminal form: a muted label line, then a bold value line
 * (with `delta` appended, colored by `trend` when recognized). A failed or
 * stale binding appends `failure-presentation.ts`'s quiet suffix to the
 * value line — the terminal has no tooltip channel, so the reason has to
 * reach the text itself (AGENTS.md's "clean is not silent").
 */
export const Stat: AnsiComponent = (attributes, _childrenText, ctx) => {
  const { data, dataStatus, dataFailureKind } = ctx;

  const bound = safeRead<StatFields>(
    () =>
      dataStatus === 'missing' || dataStatus === 'error'
        ? {}
        : readStatFields(data),
    () => ({}),
  );
  const fromData = bound.fields;

  const value = pick(attributes.value, fromData.value);
  const formattedValue = formatValue(
    value,
    attributes.format ?? undefined,
    attributes.decimals ?? undefined,
  );
  const label = pick(attributes.label, fromData.label);
  const delta = pick(attributes.delta, fromData.delta);
  const rawTrend = pick(attributes.trend, fromData.trend);
  const trend: Trend | undefined =
    rawTrend && isTrend(rawTrend) ? rawTrend : undefined;

  const lines: string[] = [];
  if (label) lines.push(ctx.style(ctx.text(label), '--mk-muted'));

  let valueLine = ctx.bold(ctx.text(formattedValue || EMPTY_VALUE));
  if (delta) {
    const deltaToken =
      trend === 'up'
        ? '--mk-success'
        : trend === 'down'
          ? '--mk-danger'
          : undefined;
    const deltaText = ctx.text(delta);
    valueLine += `  ${deltaToken ? ctx.style(deltaText, deltaToken) : deltaText}`;
  }

  const suffix = dataStateSuffix(dataStatus, dataFailureKind);
  if (suffix) {
    const token = failureToken(dataFailureKind);
    valueLine += token ? ctx.style(suffix, token) : ctx.dim(suffix);
  }
  lines.push(valueLine);

  return lines.join('\n');
};
