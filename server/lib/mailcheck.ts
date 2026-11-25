import { resolveCname, resolveMx, resolveTxt } from "node:dns/promises";

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback; // ENOTFOUND / ENODATA: the record does not exist
  }
}

const flat = (rows: string[][]) => rows.map((r) => r.join(""));

export interface MailCheck {
  domain: string;
  mx: string[];
  spf: string[];
  dmarc: string[];
  dkim: { selector: string; records: string[] } | null;
  docs: { host: string; cname: string[]; txt: string[] };
  notes: string[];
}

/** Looks up the DNS records that decide whether mail from the domain is trusted (and whether replies can arrive). */
export async function checkMailDns(domain: string, dkimSelector: string | null, docsHost: string): Promise<MailCheck> {
  const [mx, txt, dmarc, dkim, docsCname] = await Promise.all([
    safe(resolveMx(domain), []),
    safe(resolveTxt(domain), []),
    safe(resolveTxt(`_dmarc.${domain}`), []),
    dkimSelector ? safe(resolveTxt(`${dkimSelector}._domainkey.${domain}`), []) : Promise.resolve(null),
    safe(resolveCname(docsHost), []),
  ]);
  const spf = flat(txt).filter((t) => /^v=spf1/i.test(t));
  const dm = flat(dmarc).filter((t) => /^v=DMARC1/i.test(t));
  const notes: string[] = [];
  if (!mx.length) notes.push("No MX record: replies and mail sent to your domain cannot arrive.");
  if (!spf.length) notes.push("No SPF record: mail sent to external inboxes is likely to land in spam.");
  if (!dm.length) notes.push("No DMARC record.");
  if (dkimSelector && !(dkim && dkim.length)) notes.push(`No DKIM record found (${dkimSelector}._domainkey.${domain}).`);
  return {
    domain,
    mx: mx.sort((a, b) => a.priority - b.priority).map((m) => `${m.priority} ${m.exchange}`),
    spf,
    dmarc: dm,
    dkim: dkimSelector ? { selector: dkimSelector, records: flat(dkim ?? []) } : null,
    docs: { host: docsHost, cname: docsCname, txt: [] },
    notes,
  };
}
