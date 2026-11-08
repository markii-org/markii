import type { ReactElement } from 'react';
import type { MarkComponentProps } from '@markii/react';
import { stateClassName } from './guard';
import { resolveDelta } from './delta.logic';
import './delta.css';

/**
 * `:dash_delta[requests]{value=-3.2 unit="%"}` — an inline up/down triangle
 * with a formatted change value, followed by the directive's own text as a
 * label. A written `value` attribute always wins, matching
 * `@markii/react`'s own `progress`; with no usable attribute the number
 * comes from the bound `data` (a bare number, or an object's `.value`
 * field). A non-numeric result from either source degrades to `0`, the
 * neutral state, rather than throwing. Positive renders a success-toned up
 * triangle, negative a danger-toned down triangle, zero a neutral dash.
 * `unit` appends a suffix such as `%` to the number.
 *
 * The label is what keeps the inline form honest: the renderer marks an
 * inline directive written with nothing between its brackets as an
 * authoring mistake (a dashed underline plus a tooltip), so `dash_delta`
 * takes the thing that changed as its text rather than leaving the
 * brackets empty.
 */
export function Delta({
  attributes,
  children,
  data,
  dataStatus,
  dataError,
}: MarkComponentProps): ReactElement {
  const model = resolveDelta({ attributes, data, dataStatus, dataError });
  const { direction } = model;
  const title = model.failureText;

  return (
    <span className={stateClassName('mk-dash_delta', dataStatus)} title={title}>
      <span
        className={`mk-dash_delta__arrow mk-dash_delta__arrow--${direction}`}
        aria-hidden="true"
      />
      <span
        className={`mk-dash_delta__value mk-dash_delta__value--${direction}`}
      >
        {model.text}
      </span>
      {children !== undefined && children !== null && (
        <span className="mk-dash_delta__label">{children}</span>
      )}
    </span>
  );
}
