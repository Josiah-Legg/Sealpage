/** Lookup over the generated list of style definitions. */
import { STYLE_DEFINITIONS } from './index.generated';
import type { StyleDefinition } from './schema';

export const DEFAULT_STYLE_ID = 'warm-grey';

export function allStyles(): StyleDefinition[] {
  return [...STYLE_DEFINITIONS].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

export function getStyle(id: string | undefined): StyleDefinition {
  const all = STYLE_DEFINITIONS;
  return all.find((s) => s.id === id) ?? all.find((s) => s.id === DEFAULT_STYLE_ID) ?? all[0]!;
}
