/**
 * File storage for uploaded PDFs, page images and signed NDA PDFs.
 *
 *   STORAGE_DRIVER=fs       (default) files under STORAGE_DIR (default ./data/files). Mount a volume in Docker.
 *   STORAGE_DRIVER=netlify  Netlify Blobs; chosen automatically when running on Netlify.
 *   STORAGE_DRIVER=s3       Any S3-compatible object store (Cloudflare R2, AWS S3, Aliyun OSS, MinIO).
 *                           Chosen automatically when S3_BUCKET is set.
 *
 * Keys look like "pages/<version>/<n>.webp". Only the five operations below are used by the app.
 */
import { createHash, createHmac } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export interface FileStore {
  get(key: string, opts?: { type: "arrayBuffer" }): Promise<ArrayBuffer | null>;
  set(key: string, value: ArrayBuffer | Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  list(opts: { prefix: string }): Promise<{ blobs: { key: string }[] }>;
}

function fsStore(root: string): FileStore {
  // Keys are encoded into a single flat file name, so no key can ever escape the directory.
  const file = (key: string) => path.join(root, encodeURIComponent(key));
  return {
    async get(key) {
      try {
        const b = await fs.readFile(file(key));
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
      } catch {
        return null;
      }
    },
    async set(key, value) {
      await fs.mkdir(root, { recursive: true });
      const target = file(key);
      const tmp = `${target}.${process.pid}.tmp`;
      await fs.writeFile(tmp, value instanceof Uint8Array ? value : new Uint8Array(value));
      await fs.rename(tmp, target); // readers never see a half-written file
    },
    async delete(key) {
      await fs.rm(file(key), { force: true });
    },
    async exists(key) {
      try { await fs.stat(file(key)); return true; } catch { return false; }
    },
    async list({ prefix }) {
      let names: string[] = [];
      try { names = await fs.readdir(root); } catch { /* nothing stored yet */ }
      return { blobs: names.filter((n) => !n.endsWith(".tmp")).map(decodeURIComponent).filter((k) => k.startsWith(prefix)).map((key) => ({ key })) };
    },
  };
}

async function netlifyStore(): Promise<FileStore> {
  const { getStore } = await import("@netlify/blobs");
  const s = getStore({ name: "docs", consistency: "strong" });
  return {
    get: async (key) => ((await s.get(key, { type: "arrayBuffer" })) as ArrayBuffer | null),
    set: async (key, value) => { await s.set(key, value instanceof Uint8Array ? (value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer) : value); },
    delete: async (key) => { await s.delete(key); },
    exists: async (key) => (await s.getMetadata(key)) !== null,
    list: async ({ prefix }) => ({ blobs: (await s.list({ prefix })).blobs.map((b) => ({ key: b.key })) }),
  };
}

/* ---------------- Zero-dependency AWS SigV4 S3-compatible driver ---------------- */

const sha256Hex = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();
const encUri = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

function s3Store(): FileStore {
  const bucket = (process.env.S3_BUCKET ?? "").trim();
  const region = (process.env.S3_REGION ?? "auto").trim();
  const endpoint = (process.env.S3_ENDPOINT ?? `https://s3.${region}.amazonaws.com`).replace(/\/$/, "");
  const accessKey = (process.env.S3_ACCESS_KEY_ID ?? "").trim();
  const secretKey = (process.env.S3_SECRET_ACCESS_KEY ?? "").trim();
  const keyPrefix = (process.env.S3_PREFIX ?? "").replace(/^\/+|\/+$/g, "");
  if (!bucket || !accessKey || !secretKey) {
    throw new Error("S3 storage requires S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.");
  }

  const fullKey = (k: string) => (keyPrefix ? `${keyPrefix}/${k}` : k);
  const stripPrefix = (k: string) => (keyPrefix && k.startsWith(`${keyPrefix}/`) ? k.slice(keyPrefix.length + 1) : k);

  async function signedFetch(method: string, objectKey: string, query: Record<string, string> = {}, body?: Uint8Array): Promise<Response> {
    const base = new URL(endpoint);
    const pathSegments = [bucket, ...(objectKey ? objectKey.split("/") : [])].map(encUri).join("/");
    const canonicalUri = `/${pathSegments}`;
    const sortedQuery = Object.keys(query).sort().map((k) => `${encUri(k)}=${encUri(query[k])}`).join("&");
    const url = `${base.origin}${canonicalUri}${sortedQuery ? `?${sortedQuery}` : ""}`;

    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = sha256Hex(body ?? "");
    const host = base.host;

    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
    const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
    const canonicalRequest = `${method}\n${canonicalUri}\n${sortedQuery}\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;
    const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;
    const kDate = hmac(`AWS4${secretKey}`, dateStamp);
    const kRegion = hmac(kDate, region);
    const kService = hmac(kRegion, "s3");
    const kSigning = hmac(kService, "aws4_request");
    const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

    return fetch(url, {
      method,
      headers: {
        "x-amz-content-sha256": payloadHash,
        "x-amz-date": amzDate,
        authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      },
      body: body ? (body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer) : undefined,
    });
  }

  return {
    async get(key) {
      const res = await signedFetch("GET", fullKey(key));
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`S3 GET ${key} failed (${res.status})`);
      return res.arrayBuffer();
    },
    async set(key, value) {
      const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
      const res = await signedFetch("PUT", fullKey(key), {}, bytes);
      if (!res.ok) throw new Error(`S3 PUT ${key} failed (${res.status})`);
    },
    async delete(key) {
      const res = await signedFetch("DELETE", fullKey(key));
      if (!res.ok && res.status !== 404) throw new Error(`S3 DELETE ${key} failed (${res.status})`);
    },
    async exists(key) {
      const res = await signedFetch("HEAD", fullKey(key));
      return res.ok;
    },
    async list({ prefix }) {
      const res = await signedFetch("GET", "", { "list-type": "2", prefix: fullKey(prefix) });
      if (!res.ok) return { blobs: [] };
      const xml = await res.text();
      const blobs: { key: string }[] = [];
      for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) {
        const unescaped = m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        blobs.push({ key: stripPrefix(unescaped) });
      }
      return { blobs };
    },
  };
}

const driver = process.env.STORAGE_DRIVER ?? (process.env.S3_BUCKET ? "s3" : process.env.NETLIFY === "true" ? "netlify" : "fs");
const store: FileStore =
  driver === "s3" ? s3Store()
    : driver === "netlify" ? await netlifyStore()
    : fsStore(path.resolve(process.env.STORAGE_DIR ?? "./data/files"));

/** The shared file store. */
export const files = (): FileStore => store;
