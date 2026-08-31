/**
 * Directive autocompletion (GitHub issue #27, slice 1): builds
 * `ComponentDocumentation` for a catalog entry, and renders it as plain
 * text for a host with no rich-text popup. Used by both `hoverAt` and the
 * `component` completion items in `./completion.ts`.
 */
import type { PackComponentAttribute } from '@markii/pack';
import type { AttributeSchema } from '@markii/stdlib';
import { getContract } from '@markii/stdlib';
import { componentSkeleton } from '../insert/component-skeleton.js';
import type { InsertableComponent } from '../insert/component-catalog.js';
import type { ComponentDocumentation } from './types.js';

/** `name`, `name (required)`, `name: a | b`, or `name (required): a | b`. */
function attributeDocLine(name: string, schema: AttributeSchema): string {
  const requiredPart = schema.required === true ? ' (required)' : '';
  const enumPart =
    schema.enum !== undefined ? `: ${schema.enum.join(' | ')}` : '';
  return `${name}${requiredPart}${enumPart}`;
}

/**
 * The same line for a pack's declared attribute, plus the one thing a
 * standard contract has no field for: a declared `default`, appended as
 * `(default: x)`. Everything else lines up with `attributeDocLine` above
 * so a reader cannot tell from the shape of the line whether the
 * attributes came from a contract or from a `pack.json`.
 */
function packAttributeDocLine(attribute: PackComponentAttribute): string {
  const requiredPart = attribute.required === true ? ' (required)' : '';
  const valuesPart =
    attribute.values !== undefined ? `: ${attribute.values.join(' | ')}` : '';
  const defaultPart =
    attribute.default !== undefined ? ` (default: ${attribute.default})` : '';
  return `${attribute.name}${requiredPart}${valuesPart}${defaultPart}`;
}

/**
 * The one-line usage example built from `componentSkeleton`. For a
 * container, only the opening fence line is shown (`:::name{}`, with its
 * brace clause and required attributes if any) rather than the multi-line
 * `\n\n:::` body form — that is the line an author actually recognizes as
 * "how do I write this".
 */
function exampleFor(component: InsertableComponent): string {
  const skeleton = componentSkeleton(
    component.directiveName,
    component.kind,
    component.requiredAttributes,
  );
  if (component.kind !== 'container') return skeleton.text;
  const newline = skeleton.text.indexOf('\n');
  return newline === -1 ? skeleton.text : skeleton.text.slice(0, newline);
}

/**
 * Builds the structured documentation for one catalog entry: a standard
 * component's contract description and attribute list (its full prose, not
 * the picker row's first-sentence truncation), or a pack component's own
 * declared description and declared attribute list (issue #27 slice 4).
 * Never composed filler text: a pack that declares neither gets empty
 * strings and an empty list, and the host decides what, if anything, to
 * show in their place.
 */
export function componentDocumentation(
  component: InsertableComponent,
): ComponentDocumentation {
  const example = exampleFor(component);

  if (component.source === 'standard') {
    const contract = getContract(component.directiveName);
    if (contract === undefined) {
      return { summary: component.description ?? '', attributes: [], example };
    }
    return {
      summary: contract.description,
      attributes: Object.entries(contract.attributes).map(([name, schema]) =>
        attributeDocLine(name, schema),
      ),
      example,
    };
  }

  return {
    summary: component.description ?? '',
    attributes: (component.attributes ?? []).map((attribute) =>
      packAttributeDocLine(attribute),
    ),
    example,
  };
}

/**
 * Renders `ComponentDocumentation` as plain text for a host with no
 * rich-text popup:
 *
 * ```
 * <summary>
 *
 * Attributes:
 * - type: info | warning | danger
 * - title
 *
 * Example: :::callout{}
 * ```
 *
 * Any section with nothing to show is omitted entirely, and the result
 * never ends with a trailing blank line. All-empty documentation formats to
 * the empty string.
 */
export function formatComponentDocumentation(
  doc: ComponentDocumentation,
): string {
  const sections: string[] = [];

  if (doc.summary.length > 0) sections.push(doc.summary);

  if (doc.attributes.length > 0) {
    sections.push(
      ['Attributes:', ...doc.attributes.map((line) => `- ${line}`)].join('\n'),
    );
  }

  if (doc.example.length > 0) sections.push(`Example: ${doc.example}`);

  return sections.join('\n\n');
}
