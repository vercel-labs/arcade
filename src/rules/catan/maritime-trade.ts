import { RESOURCES, type Port, type Resource } from './types.ts';

export type MaritimeTradeRate = 2 | 3 | 4;
export type MaritimeTradeRates = Record<Resource, MaritimeTradeRate>;
export type MaritimePortTradeRate = 2 | 3;
export type MaritimePortTradeRates = Record<Resource, MaritimePortTradeRate[]>;

// The rules only care which coastal nodes a player occupies. A settlement and a city grant the
// same harbor access, so callers pass occupied node ids rather than building types.
export function portsAtNodes(
  harbors: readonly { port: Port; nodes: readonly number[] }[],
  nodes: Iterable<number>,
): Port[] {
  const occupied = new Set(nodes);
  const ports: Port[] = [];
  for (const harbor of harbors) {
    if (!harbor.nodes.some((node) => occupied.has(node))) continue;
    if (!ports.some((port) => port.ratio === harbor.port.ratio && port.resource === harbor.port.resource)) {
      ports.push(harbor.port);
    }
  }
  return ports;
}

export function maritimeTradeRate(ports: readonly Port[], resource: Resource): MaritimeTradeRate {
  return maritimePortTradeRates(ports)[resource][0] ?? 4;
}

// Port trades are choices, not merely a discount ladder. A matching 2:1 port and a generic 3:1
// port both remain available for the same offered resource; callers can select either ratio.
export function maritimePortTradeRates(ports: readonly Port[]): MaritimePortTradeRates {
  const generic = ports.some((port) => port.ratio === 3);
  return Object.fromEntries(RESOURCES.map((resource) => {
    const rates: MaritimePortTradeRate[] = [];
    if (ports.some((port) => port.ratio === 2 && port.resource === resource)) rates.push(2);
    if (generic) rates.push(3);
    return [resource, rates];
  })) as MaritimePortTradeRates;
}

export function maritimeTradeRates(ports: readonly Port[]): MaritimeTradeRates {
  return Object.fromEntries(
    RESOURCES.map((resource) => [resource, maritimeTradeRate(ports, resource)]),
  ) as MaritimeTradeRates;
}
