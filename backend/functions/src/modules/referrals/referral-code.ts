/**
 * ============================================================================
 * REFERRAL CODE GENERATION AND NORMALISATION
 * ============================================================================
 *
 * Pure. No Firestore, no I/O, no clock - so every rule here is unit-testable and
 * the same helpers serve both the callable and the tests.
 *
 * WHY CODES ARE NOT DERIVED FROM THE UID
 *
 * The previous placeholder built a "code" client-side as
 * `WSL-${uid.slice(0, 6).toUpperCase()}`. That is unsafe in both directions:
 * anyone holding a uid can forge the code, and anyone shown a code learns six
 * characters of a real uid. Codes are now random, issued by the server, and the
 * code -> owner mapping lives in a collection no client can read.
 *
 * ALPHABET
 *
 * Crockford-style: I, L, O and U are excluded along with the digits 0 and 1.
 * That removes the O/0 and I/1/L confusions when a code is read aloud or copied
 * off a screen, and dropping U avoids accidental profanity. 30 symbols over 6
 * positions is ~729 million codes, which is ample - but "unlikely to collide" is
 * not the same as "correct under collision", so issuance still reserves the code
 * with a transactional create and retries on conflict.
 * ============================================================================
 */

/** Unambiguous symbols only. See the note above before changing this. */
export const REFERRAL_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

/** Random portion length. 30^6 ~= 729M. */
export const REFERRAL_CODE_LENGTH = 6;

/** Human-recognisable prefix. Not a security control. */
export const REFERRAL_CODE_PREFIX = 'WSL';

/**
 * Canonicalise anything a user typed into the form stored as the document id.
 *
 * Deliberately strips separators, so a passenger who types the legacy `WSL-ABC123`
 * still resolves to `WSLABC123`. Note this differs from `normalizePromoCode`,
 * which PRESERVES `-` and `_` because promo codes are chosen by managers and may
 * legitimately contain them. Referral codes are machine-generated and never do.
 */
export function normalizeReferralCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);
}

/**
 * Generate one candidate code.
 *
 * `random` is injected so a test can force a deterministic value - and, more
 * importantly, force a COLLISION to prove the reservation retry works. Callers
 * must treat the result as a candidate only: it is not unique until reserved.
 */
export function generateReferralCode(random: () => number = Math.random): string {
  let suffix = '';
  for (let index = 0; index < REFERRAL_CODE_LENGTH; index += 1) {
    const position = Math.floor(random() * REFERRAL_ALPHABET.length);
    // Guard against a random() that returns exactly 1 or drifts out of range.
    const safePosition = Math.min(Math.max(position, 0), REFERRAL_ALPHABET.length - 1);
    suffix += REFERRAL_ALPHABET[safePosition];
  }
  return `${REFERRAL_CODE_PREFIX}${suffix}`;
}

/** True if `value` is shaped like a code this module would issue. */
export function isWellFormedReferralCode(value: string): boolean {
  if (!value.startsWith(REFERRAL_CODE_PREFIX)) return false;
  const suffix = value.slice(REFERRAL_CODE_PREFIX.length);
  if (suffix.length !== REFERRAL_CODE_LENGTH) return false;
  return [...suffix].every((character) => REFERRAL_ALPHABET.includes(character));
}
