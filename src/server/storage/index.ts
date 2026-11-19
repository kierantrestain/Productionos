/**
 * Object storage. `local` writes to ./storage for development only; production must use `s3`
 * (any S3-compatible provider: AWS S3, Cloudflare R2, Backblaze B2 …). Bytes never go to Postgres.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

export interface Storage {
  name: string;
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}

const safeKey = (key: string) => {
  if (!/^[A-Za-z0-9/_.-]+$/.test(key) || key.includes("..")) throw new Error("Invalid storage key");
  return key;
};

class LocalStorage implements Storage {
  name = "local";
  constructor(private root = path.resolve(process.cwd(), "storage")) {}
  async put(key: string, bytes: Buffer) {
    const p = path.join(this.root, safeKey(key));
    await mkdir(path.dirname(p), { recursive: true, mode: 0o700 });
    await writeFile(p, bytes, { mode: 0o600 });
  }
  async get(key: string) { return readFile(path.join(this.root, safeKey(key))); }
}

class S3Storage implements Storage {
  name = "s3";
  private client = new S3Client({
    region: process.env.STORAGE_REGION || "auto",
    endpoint: process.env.STORAGE_ENDPOINT || undefined,
    forcePathStyle: !!process.env.STORAGE_ENDPOINT,
    credentials: { accessKeyId: process.env.STORAGE_ACCESS_KEY_ID!, secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY! },
  });
  private bucket = process.env.STORAGE_BUCKET!;
  async put(key: string, bytes: Buffer, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: safeKey(key), Body: bytes, ContentType: contentType, ServerSideEncryption: process.env.STORAGE_ENDPOINT ? undefined : "AES256" }));
  }
  async get(key: string) {
    const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: safeKey(key) }));
    return Buffer.from(await r.Body!.transformToByteArray());
  }
}

export class DbStorage implements Storage {
  name = "db";
  async put(key: string, bytes: Buffer, contentType: string) {
    const { db } = await import("@/db");
    const { fileBlobs } = await import("@/db/schema");
    await db.insert(fileBlobs).values({ storageKey: safeKey(key), bytes, contentType }).onConflictDoNothing();
  }
  async get(key: string) {
    const { db } = await import("@/db");
    const { fileBlobs } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");
    const [r] = await db.select().from(fileBlobs).where(eq(fileBlobs.storageKey, safeKey(key))).limit(1);
    if (!r) throw new Error("File not found in storage");
    return Buffer.from(r.bytes);
  }
}

let instance: Storage | null = null;
export function storage(): Storage {
  if (instance) return instance;
  const provider = process.env.STORAGE_PROVIDER || "local";
  if (provider === "s3") {
    for (const k of ["STORAGE_BUCKET", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY"]) if (!process.env[k]) throw new Error(`${k} is required for S3 storage`);
    instance = new S3Storage();
  } else if (provider === "db") {
    instance = new DbStorage();
  } else {
    if (process.env.VERCEL) throw new Error("Local storage is not durable on Vercel. Configure STORAGE_PROVIDER=s3.");
    instance = new LocalStorage();
  }
  return instance;
}
export function storageStatus() {
  const provider = process.env.STORAGE_PROVIDER || "local";
  return { provider, durable: provider !== "local", note: provider === "s3" ? "S3-compatible object storage" : provider === "db" ? "PostgreSQL (bytea) — durable; move to S3/R2 for large media" : "Local disk (development only)" };
}
