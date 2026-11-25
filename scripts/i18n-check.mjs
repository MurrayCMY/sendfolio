// Lists UI strings that have no Chinese translation, and translations that no longer match any string.
//   npm run i18n:check          exit code 1 if something is missing (used in CI)
import fs from "node:fs";
import path from "node:path";

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.(tsx?|mts)$/.test(e.name) ? [p] : [];
  });
}

// t("text") / t("text", args...) with a plain double-quoted literal
const used = new Set();
const re = /\bt\(\s*("(?:[^"\\]|\\.)*")/g;
for (const f of walk("src")) {
  const norm = f.replace(/\\/g, "/");
  if (norm.startsWith("src/locales/") || norm === "src/i18n.ts") continue;
  const text = fs.readFileSync(f, "utf8");
  for (const m of text.matchAll(re)) used.add(JSON.parse(m[1]));
}

const src = fs.readFileSync("src/locales/zh.ts", "utf8");
const zh = {};
for (const m of src.matchAll(/^\s+("(?:[^"\\]|\\.)*"):\s*("(?:[^"\\]|\\.)*"),\s*$/gm)) zh[JSON.parse(m[1])] = JSON.parse(m[2]);

const missing = [...used].filter((k) => !(k in zh));
// Server error messages are English too; they are translated in the browser, so they live in zh.ts as well.
const serverKeys = new Set();
for (const f of walk("server")) {
  if (f.endsWith("font-data.ts")) continue;
  const text = fs.readFileSync(f, "utf8");
  for (const m of text.matchAll(/\b(?:fail|err)\(\s*\d+\s*,\s*(?:"[a-z_]+"\s*,\s*)?("(?:[^"\\]|\\.)*")/g)) serverKeys.add(JSON.parse(m[1]));
}
const missingServer = [...serverKeys].filter((k) => !(k in zh));
const placeholderMismatch = Object.entries(zh).filter(([k, v]) => [...k.matchAll(/\{\d+\}/g)].map((x) => x[0]).sort().join() !== [...v.matchAll(/\{\d+\}/g)].map((x) => x[0]).sort().join());

if (missing.length) console.log(`UI strings without a Chinese translation (${missing.length}):\n  ` + missing.join("\n  "));
if (missingServer.length) console.log(`Server messages without a Chinese translation (${missingServer.length}):\n  ` + missingServer.join("\n  "));
if (placeholderMismatch.length) console.log(`Translations whose {0} placeholders differ from the English text:\n  ` + placeholderMismatch.map(([k]) => k).join("\n  "));
const failed = missing.length + missingServer.length + placeholderMismatch.length;
console.log(failed ? `\n${failed} problem(s).` : `i18n OK: ${used.size} UI strings and ${serverKeys.size} server messages have translations.`);
process.exit(failed ? 1 : 0);
