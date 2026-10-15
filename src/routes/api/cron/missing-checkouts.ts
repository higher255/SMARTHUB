import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db.server";
import { audit, notifyInApp, usersWithPermission } from "@/lib/ehs/core";

export const Route = createFileRoute("/api/cron/missing-checkouts")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const secret = process.env.CRON_SECRET;
        if (!secret) return Response.json({ error: "Cron authorization is not configured" }, { status: 503 });
        if (request.headers.get("authorization") !== `Bearer ${secret}`) {
          return Response.json({ error: "Unauthorized" }, { status: 401 });
        }

        const sql = await getSql();
        const autoClosed = await sql<{
          id: number;
          user_id: string;
          organization_id: string;
          employee_name: string;
        }>`with closed as (
            update attendance a set check_out = now(), auto_checkout = true
            from profiles p
            where p.user_id::text = a.user_id::text and p.organization_id::text = a.organization_id::text and p.status = 'active'
              and a.work_date = (now() at time zone 'Africa/Dar_es_Salaam')::date and a.check_out is null
              and to_char(now() at time zone 'Africa/Dar_es_Salaam', 'HH24MI') >= '2000'
            returning a.id, a.user_id, a.organization_id, p.full_name as employee_name
          ), review_rows as (
            insert into attendance_checkout_reviews (attendance_id, organization_id, user_id)
            select id, organization_id::text, user_id::text from closed
            on conflict (attendance_id) do nothing
            returning attendance_id
          )
          select closed.id, closed.user_id::text as user_id, closed.organization_id::text as organization_id, closed.employee_name
          from closed join review_rows on review_rows.attendance_id = closed.id`;

        for (const row of autoClosed) {
          await audit(sql, row.organization_id, "system", "auto_checkout", "attendance", row.id, { scheduledLocalTime: "20:00 Africa/Dar_es_Salaam", userId: row.user_id });
          const hr = await usersWithPermission(sql, row.organization_id, "hr.manage");
          await notifyInApp(sql, {
            organizationId: row.organization_id,
            userIds: [row.user_id],
            title: "Automatic attendance check-out",
            message: "Your attendance session was automatically checked out at 20:00 because no check-out was recorded. Please add a reason in My work. HR can then approve it or request more details.",
            type: "attendance",
            link: "/dashboard",
            entityType: "attendance_auto_checkout",
            entityId: row.id,
          });
          await notifyInApp(sql, {
            organizationId: row.organization_id,
            userIds: hr,
            title: "Attendance reason required",
            message: `${row.employee_name} was automatically checked out at 20:00 and needs to submit a reason for HR review.`,
            type: "attendance",
            link: "/hr",
            entityType: "attendance_auto_checkout",
            entityId: row.id,
          });
        }

        return Response.json({ ok: true, autoCheckedOut: autoClosed.length });
      },
    },
  },
});
