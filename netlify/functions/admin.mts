// Netlify deployment target: a thin wrapper around the portable handler in server/handlers.
import type { Config, Context } from "@netlify/functions";
import handler from "../../server/handlers/admin";

export default (req: Request, ctx: Context) => handler(req, ctx);
export const config: Config = { path: "/api/admin/*" };
