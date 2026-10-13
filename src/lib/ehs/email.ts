/**
 * Optional email sending through Resend (https://resend.com). Set RESEND_API_KEY and EMAIL_FROM to turn it on.
 * Without them the app works normally; "forgot password" then tells people to ask their administrator.
 */
export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail(input: { to: string; subject: string; html: string; text?: string }): Promise<void> {
  if (!emailConfigured()) throw new Error("Email is not set up");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [input.to], subject: input.subject, html: input.html, text: input.text }),
  });
  if (!res.ok) throw new Error(`Email provider refused the message (${res.status})`);
}
