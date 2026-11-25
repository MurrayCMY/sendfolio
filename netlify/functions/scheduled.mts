// Netlify deployment target: runs the background job every 10 minutes.
import type { Config } from "@netlify/functions";
import run from "../../server/handlers/scheduled";

export default async () => { await run(); };
export const config: Config = { schedule: "*/10 * * * *" };
