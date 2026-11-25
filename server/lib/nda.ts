import { createHash } from "node:crypto";
import { db } from "./db";
import { NDA_DEFAULT_EN, NDA_DEFAULT_LABEL, NDA_DEFAULT_ZH } from "./nda-default";

export interface NdaVersion {
  id: string;
  label: string;
  body_zh: string;
  body_en: string;
  sha256: string;
  active: boolean;
  created_at: string;
}

/** Hash covers both language versions, so a record proves exactly what was accepted. */
export const ndaHash = (zh: string, en: string) =>
  createHash("sha256").update(`${zh}\n---\n${en}`).digest("hex");

/** Returns the active NDA, installing the bundled sample template the first time (no NDA exists yet). */
export async function getActiveNda(): Promise<NdaVersion> {
  const find = () =>
    db.sql<NdaVersion>`select id, label, body_zh, body_en, sha256, active, created_at from nda_versions where active`;
  let [row] = await find();
  if (row) return row;
  const zh = NDA_DEFAULT_ZH();
  const en = NDA_DEFAULT_EN();
  await db.sql`
    insert into nda_versions (label, body_zh, body_en, sha256, pdf_blob_key, active)
    values (${NDA_DEFAULT_LABEL}, ${zh}, ${en}, ${ndaHash(zh, en)}, '', true)
    on conflict do nothing`;
  [row] = await find();
  return row;
}
