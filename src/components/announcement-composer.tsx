import { useState, type FormEvent } from "react";
import { Bell, Megaphone } from "lucide-react";
import { createAnnouncement } from "@/lib/ehs/server";
import { Field, inputClass, primaryBtn } from "@/components/app-shell";

export function AnnouncementComposer({ onPublished }: { onPublished?: () => void }) {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [durationDays, setDurationDays] = useState("1");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);

  const publish = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setFeedback("");
    try {
      const start = startsAt ? new Date(startsAt) : new Date();
      if (Number.isNaN(start.getTime())) throw new Error("Choose a valid start time.");
      const end = new Date(start.getTime() + Number(durationDays) * 24 * 60 * 60 * 1000);
      await createAnnouncement({ data: { title, message, startsAt: start.toISOString(), endsAt: end.toISOString(), durationDays: Number(durationDays) } });
      setTitle("");
      setMessage("");
      setStartsAt("");
      setDurationDays("1");
      setFeedback("Announcement published.");
      onPublished?.();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not publish announcement.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={publish} className="grid gap-3 rounded-xl border border-border bg-bg-elevated p-5 lg:grid-cols-[1fr_1.5fr_auto_auto_auto] lg:items-end">
      <Field label="Announcement title">
        <input required value={title} onChange={(event) => setTitle(event.target.value)} className={inputClass} placeholder="Planned site outage" />
      </Field>
      <Field label="Message">
        <input required value={message} onChange={(event) => setMessage(event.target.value)} className={inputClass} placeholder="Share an operational update" />
      </Field>
      <Field label="Start time">
        <input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} className={inputClass} />
      </Field>
      <Field label="Visible for">
        <select value={durationDays} onChange={(event) => setDurationDays(event.target.value)} className={inputClass}>
          <option value="1">1 day</option>
          <option value="3">3 days</option>
          <option value="7">7 days</option>
          <option value="14">14 days</option>
          <option value="20">20 days</option>
        </select>
      </Field>
      <button disabled={busy} className={primaryBtn} type="submit"><Megaphone className="size-4" /> {busy ? "Publishing..." : "Publish"}</button>
      {feedback ? <p className="text-sm text-fg-muted lg:col-span-full"><Bell className="mr-1 inline size-4" />{feedback}</p> : null}
    </form>
  );
}
