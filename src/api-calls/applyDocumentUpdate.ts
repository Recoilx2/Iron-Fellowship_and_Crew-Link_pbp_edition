/**
 * Applies a partial app-level update (including dotted field paths such as
 * `"optionValues.key"` or `"conditionMeters.health"`) onto plain JSON,
 * following the previous merge semantics at the data-layer edge.
 */
export function applyDocumentUpdate(
  base: Record<string, unknown>,
  update: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [path, value] of Object.entries(update)) {
    const segments = path.split(".");
    if (segments.length === 1) {
      result[path] = value;
      continue;
    }
    let target = result;
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i];
      const nested = target[segment];
      if (nested !== null && typeof nested === "object" && !Array.isArray(nested)) {
        target[segment] = { ...(nested as Record<string, unknown>) };
      } else {
        target[segment] = {};
      }
      target = target[segment] as Record<string, unknown>;
    }
    target[segments[segments.length - 1]] = value;
  }
  return result;
}
