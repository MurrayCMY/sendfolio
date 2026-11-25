import { db } from "../lib/db";
import { sendNdaEmail } from "../lib/nda-sign";
import { sendSummary } from "../lib/notify";
import { migrate } from "../lib/migrate";

// Serverless platforms start handlers independently; make sure the schema exists first (no-op when already current).
await migrate();

/**
 * Runs every 10 minutes (UTC cron; the schedule has no local-time component).
 *  1. Retries NDA confirmation emails that did not go out (SMTP hiccup), after a 3 minute grace period.
 *  2. Sends reading summaries for visits that ended, i.e. no heartbeat for 15 minutes.
 * Scheduled functions have a 30 s limit, so each run handles a few items; the rest wait for the next run.
 */
export default async () => {
  const pendingNda = await db.sql<{ id: string }>`
    select id from nda_acceptances
    where email_sent_at is null and accepted_at < now() - interval '3 minutes' and accepted_at > now() - interval '2 days'
    order by accepted_at limit 3`;
  for (const a of pendingNda) {
    try {
      await sendNdaEmail(a.id);
    } catch (e) {
      console.error("NDA email retry failed", a.id, e);
    }
  }

  // Only tracked visits (at least one page view) have anything to summarise.
  const ended = await db.sql<{ id: string }>`
    select v.id from visits v join links l on l.id = v.link_id
    where v.summary_sent_at is null and l.notify_on_open
      and coalesce(v.last_heartbeat_at, v.started_at) < now() - interval '15 minutes'
      and exists (select 1 from page_views p where p.visit_id = v.id)
    order by coalesce(v.last_heartbeat_at, v.started_at) limit 4`;
  for (const v of ended) {
    try {
      await sendSummary(v.id);
    } catch (e) {
      console.error("summary failed", v.id, e);
    }
  }
  // Visits with no page views at all never get a summary; mark them so they are not scanned forever.
  await db.sql`
    update visits set summary_sent_at = now()
    where summary_sent_at is null and coalesce(last_heartbeat_at, started_at) < now() - interval '1 day'`;
};

