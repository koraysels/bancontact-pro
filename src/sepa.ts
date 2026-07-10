/**
 * Sanitize a string to the SEPA-safe character set so a valid sale is never
 * rejected on an exotic character (e.g. the é in "club maté"). Collapses runs of
 * whitespace, strips anything outside the allowed set, and trims.
 *
 * @param input the raw string
 * @param maxLength optional cap (the reference field is limited to 35 chars)
 */
export function sepaSafe(input: string, maxLength = 140): string {
  return input
    .replace(/[^A-Za-z0-9 /?:().,'+-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}
