import { storeRequestAttachments } from "./server";

export type PendingFile = { file: File };
type AttachmentEntity = "finance_request" | "permit" | "inspection";

async function toDataUrl(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${file.type};base64,${btoa(binary)}`;
}

export async function uploadPending(entityType: AttachmentEntity, entityId: number | string, files: PendingFile[]): Promise<number> {
  if (files.length === 0) return 0;
  try {
    const attachments = await Promise.all(files.map(async ({ file }) => ({
      fileName: file.name,
      contentType: file.type,
      sizeBytes: file.size,
      dataUrl: await toDataUrl(file),
    })));
    await storeRequestAttachments({ data: { entityType, entityId: String(entityId), files: attachments } });
    return 0;
  } catch {
    return files.length;
  }
}