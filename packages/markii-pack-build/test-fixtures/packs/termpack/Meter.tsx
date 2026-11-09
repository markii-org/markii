import { meterFraction } from './meter.logic';

export function Meter(props: { attributes: Record<string, string> }) {
  return <progress value={meterFraction(props.attributes['value'])} />;
}
