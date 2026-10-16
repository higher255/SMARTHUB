import { createFileRoute } from "@tanstack/react-router";
import { RoleGate } from "@/components/role-gate";
import { FinanceRequestWorkspace } from "@/components/requests/finance-request-workspace";

export const Route = createFileRoute("/requests")({
  component: () => <RoleGate path="/requests">{(profile) => <FinanceRequestWorkspace profile={profile} />}</RoleGate>,
});
