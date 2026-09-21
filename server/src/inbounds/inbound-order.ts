import { Inbound } from './entities/inbound.entity';

export function sortInboundsByPosition(inbounds: Inbound[]): Inbound[] {
  return [...inbounds].sort(
    (left, right) =>
      (left.position ?? 0) - (right.position ?? 0) || left.id - right.id,
  );
}
