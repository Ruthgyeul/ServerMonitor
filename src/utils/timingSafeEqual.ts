// Constant-time string comparison. Used by the API auth gate and the login
// route. Kept dependency-free (no node:crypto) so it stays cheap and portable.
//
// The time taken is made as uniform as possible across differing lengths and
// values, so a token can't be recovered one character at a time via timing.
export function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  // Iterate over the longer length so the same number of bytes is compared even when lengths differ.
  const length = Math.max(aBytes.length, bBytes.length);
  let mismatch = aBytes.length ^ bBytes.length;
  for (let i = 0; i < length; i += 1) {
    mismatch |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return mismatch === 0;
}
