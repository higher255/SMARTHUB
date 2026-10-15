import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db.server";
import { notify, usersWithPermission } from "@/lib/ehs/core";

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
        const openAttendance = await sql<{
          id: number;
          user_id: string;
          organization_id: string;
          employee_name: string;
        }>`select a.id, a.user_id, a.organization_id, p.full_name as employee_name
          from attendance a
          join profiles p on p.user_id = a.user_id and p.organization_id = a.organization_id
          where a.work_date = current_date and a.check_out is null and p.status = 'active'
            and not exists (
              select 1 from notifications n
              where n.user_id = a.user_id and n.entity_type = 'attendance_missing_checkout'
                and n.entity_id = a.id::text and n.created_at::date = current_date
            )
          order by a.organization_id, p.full_name`;

        let notified = 0;
        for (const row of openAttendance) {
          const [hr, ehs] = await Promise.all([
            usersWithPermission(sql, row.organization_id, "hr.manage"),
            usersWithPermission(sql, row.organization_id, "ehs.manage"),
          ]);
          await notify(sql, {
            organizationId: row.organization_id,
            userIds: [...new Set([row.user_id, ...hr, ...ehs])],
            title: "Check-out reminder",
            message: `${row.employee_name} checked in today but has not checked out. Please confirm their status and record the check-out if needed.`,
            type: "attendance",
            link: "/dashboard",
            entityType: "attendance_missing_checkout",
            entityId: row.id,
          });
          notified += 1;
        }

        return Response.json({ ok: true, notified });
      },
    },
  },
});
