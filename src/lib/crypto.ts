/**
 * Cryptographic utilities using the Web Crypto API.
 * Provides SHA-256 hashing and secure room code generation.
 */

/**
 * Computes the SHA-256 hash of the given data using the Web Crypto API.
 * @param data - The raw binary data to hash.
 * @returns A lowercase hex-encoded SHA-256 digest string.
 */
export async function computeSHA256(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);

  let hex = '';
  for (let i = 0; i < hashArray.length; i++) {
    hex += hashArray[i].toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Characters used for room code generation.
 * Excludes ambiguous characters: 0/O, 1/I/L.
 */
const ROOM_CODE_CHARS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const ROOM_CODE_LENGTH = 6;

/**
 * Generates a cryptographically random 6-character alphanumeric room code.
 * Uses uppercase letters and digits, excluding ambiguous characters (0, O, 1, I, L).
 * @returns A 6-character room code string.
 */
export function generateRoomCode(): string {
  const values = crypto.getRandomValues(new Uint8Array(ROOM_CODE_LENGTH));
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_CHARS[values[i] % ROOM_CODE_CHARS.length];
  }
  return code;
}
