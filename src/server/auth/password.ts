import { randomBytes, scrypt as _scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;
const N = 16384, R = 8, P = 1, KEYLEN = 64;
const SEP = "$";

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 10) throw new Error("Password must be at least 10 characters");
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return ["scrypt", N, R, P, salt.toString("base64"), hash.toString("base64")].join(SEP);
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [algo, n, rr, pp, saltB64, hashB64] = stored.split(SEP);
  if (algo !== "scrypt" || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  if (!expected.length) return false;
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, { N: +n, r: +rr, p: +pp, maxmem: 64 * 1024 * 1024 });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function newToken(): string { return randomBytes(32).toString("base64url"); }
export function sha256(s: string | Buffer): string { return createHash("sha256").update(s).digest("hex"); }

/** Dummy hash used to equalise timing when the user does not exist. */
export const DUMMY_HASH = ["scrypt", N, R, P, "AAAAAAAAAAAAAAAAAAAAAA==", Buffer.alloc(KEYLEN).toString("base64")].join(SEP);
