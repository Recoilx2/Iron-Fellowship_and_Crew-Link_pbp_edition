/**
 * Short reference codes for user-facing failures (story 38): the user sees
 * only the generic message plus this code, while details stay in logs. Chat
 * surfaces failures in two places -- API toasts and inline composer alerts
 * -- so both mint the same shape of code from here instead of each
 * formatting its own.
 */
export function mintErrorReference(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, "0");
}
