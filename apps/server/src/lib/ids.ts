/** Contract-style prefixed id, e.g. newId("ses") → "ses_3f9a…". */
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}
