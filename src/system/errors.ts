// One way to turn caught values into displayable messages.
export function toMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
