export function emailDeliveryNote(status?: string): string {
  if (status === "sent") return " Email notification sent.";
  if (status === "not_configured") return " Dashboard updated; email is not configured for this workspace.";
  if (status === "failed") return " Dashboard updated, but the email could not be delivered.";
  if (status === "no_recipient") return " Dashboard updated; no active email address was found for the recipient.";
  return "";
}
