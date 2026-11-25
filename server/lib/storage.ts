/**
 * File storage for uploaded PDFs, page images and signed NDA PDFs.
 *
 *   STORAGE_DRIVER=fs       (default) files under STORAGE_DIR (default ./data/files). Mount a volume in Docker.
 *   STORAGE_DRIVER=netlify  Netlify Blobs; chosen automatically when running on Netlify.
 *
 * Keys look like "pages/<version>/<n>.webp". Only the four operations below are used by the app.
 */
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

const driver = process.env.STORAGE_DRIVER ?? (process.env.NETLIFY === "true" ? "netlify" : "fs");
const store: FileStore = driver === "netlify" ? await netlifyStore() : fsStore(path.resolve(process.env.STORAGE_DIR ?? "./data/files"));

/** The shared file store. */
export const files = (): FileStore => store;
