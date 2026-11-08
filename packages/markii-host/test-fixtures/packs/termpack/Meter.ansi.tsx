import { Text } from 'ink';
import { meterFraction } from './meter.logic';

export function Meter(props: { attributes: Record<string, string> }) {
  const filled = Math.round(meterFraction(props.attributes['value']) * 10);
  return <Text>{'#'.repeat(filled)}</Text>;
}
