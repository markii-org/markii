import { failureTitle, isUnreadable, safeExtract, str } from './guard';

export type StatusState = 'ok' | 'warn' | 'down' | 'unknown';

function normalizeState(raw: string): StatusState {
  return raw === 'ok' || raw === 'warn' || raw === 'down' ? raw : 'unknown';
}

/** A bound string overrides the `state` attribute; anything else (missing, non-string, unreadable) leaves the attribute in charge. */
function extractState(data: unknown): string | undefined {
  return typeof data === 'string' ? data : undefined;
}

export interface StatusModel {
  state: StatusState;
  failureText: string | undefined;
}

export function resolveStatus(input: {
  attributes: Record<string, unknown>;
  data: unknown;
  dataStatus: string | undefined;
  dataError: string | undefined;
}): StatusModel {
  const bound = safeExtract<string | undefined>(
    () =>
      isUnreadable(input.dataStatus) ? undefined : extractState(input.data),
    () => undefined,
  );
  const raw = bound.fields ?? str(input.attributes.state, '');
  return {
    state: normalizeState(raw),
    failureText: failureTitle(input.dataError, bound.fault),
  };
}
