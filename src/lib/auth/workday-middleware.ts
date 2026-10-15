import { createMiddleware } from "@tanstack/react-start";

/** Blocks work actions until the signed-in employee has an open attendance check-in today. */
export const workdayMiddleware = createMiddleware({ type: "function" }).server(async ({ context, next }) => {
  const { getSql } = await import("@/lib/db.server");
  const userId = (context as unknown as { userId?: string } | undefined)?.userId;
  if (!userId) throw new Error("Sign in to continue.");
  const sql = await getSql();
  const rows = await sql`select 1 from attendance where user_id = ${userId} and work_date = (now() at time zone 'Africa/Dar_es_Salaam')::date and check_out is null limit 1`;
  if (!rows[0]) throw new Error("Check in from My work before starting work.");
  return next();
});
