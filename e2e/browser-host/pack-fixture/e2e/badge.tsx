export function Badge({
  attributes,
}: {
  attributes: Record<string, string | undefined>;
}) {
  return (
    <span className="e2e_badge" data-testid="pack-badge">
      pack says: {attributes.label ?? 'nothing'}
    </span>
  );
}
