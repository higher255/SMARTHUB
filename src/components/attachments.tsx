import { useState, type ChangeEvent } from "react";
import { Paperclip, X } from "lucide-react";
import type { PendingFile } from "@/lib/ehs/attachments";

const MAX_FILES = 5;
const MAX_FILE_BYTES = 2.5 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);

export function AttachmentPicker({ files, onChange, onError }: {
  files: PendingFile[];
  onChange: (files: PendingFile[]) => void;
  onError: (message: string) => void;
}) {
  const [inputKey, setInputKey] = useState(0);
  const addFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(event.target.files ?? []);
    const remaining = MAX_FILES - files.length;
    const accepted: PendingFile[] = [];
    for (const file of selected) {
      if (accepted.length >= remaining) {
        onError(`You can attach up to ${MAX_FILES} files`);
        break;
      }
      if (file.size < 1 || file.size > MAX_FILE_BYTES) {
        onError(`${file.name} is larger than 2.5 MB or empty`);
        continue;
      }
      if (!ACCEPTED_TYPES.has(file.type)) {
        onError(`${file.name} is not a supported PDF, JPEG or PNG file`);
        continue;
      }
      accepted.push({ file });
    }
    if (accepted.length) onChange([...files, ...accepted]);
    setInputKey((key) => key + 1);
  };

  return (
    <div className="space-y-2">
      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-fg-muted">
        <Paperclip className="size-4" /> Attach files
        <input key={inputKey} type="file" accept="application/pdf,image/jpeg,image/png" multiple className="sr-only" onChange={addFiles} />
      </label>
      <p className="text-xs text-fg-subtle">PDF, JPEG or PNG · up to 5 files · 2.5 MB each</p>
      {files.length ? (
        <ul className="space-y-1">
          {files.map(({ file }, index) => (
            <li key={`${file.name}-${file.lastModified}-${index}`} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs">
              <Paperclip className="size-3.5 shrink-0 text-fg-subtle" />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="shrink-0 text-fg-subtle">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
              <button type="button" aria-label={`Remove ${file.name}`} onClick={() => onChange(files.filter((_, fileIndex) => fileIndex !== index))} className="grid size-6 shrink-0 place-items-center rounded text-fg-muted hover:bg-bg-subtle"><X className="size-3.5" /></button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}