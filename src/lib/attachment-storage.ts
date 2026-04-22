import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const allowedExtensions = new Set([".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".txt", ".csv", ".tsv"]);
const allowedMimeTypes = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/plain",
  "text/csv",
  "text/tab-separated-values",
]);
const maxAttachmentBytes = 8 * 1024 * 1024;
const attachmentRootSegments = ["uploads", "attachments"] as const;

export class AttachmentStorageError extends Error {}

export type PreparedAttachmentUpload = {
  label: string;
  fileName: string;
  fileType: string;
  storageUrl: string;
};

function sanitizeSegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sanitizeFileName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
}

function buildAttachmentAbsolutePath(storageUrl: string) {
  const normalized = storageUrl.replace(/^\/+/, "");
  return path.join(process.cwd(), "public", normalized);
}

function inferFileType(extension: string) {
  switch (extension) {
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".csv":
      return "text/csv";
    case ".tsv":
      return "text/tab-separated-values";
    default:
      return "text/plain";
  }
}

export async function storeUploadedAttachment(input: {
  category: string;
  file: File;
  label?: string;
}): Promise<PreparedAttachmentUpload> {
  const originalName = input.file.name?.trim() || "attachment";
  const extension = path.extname(originalName).toLowerCase();
  const normalizedType = input.file.type?.trim().toLowerCase() || inferFileType(extension);

  if (!input.file.size) {
    throw new AttachmentStorageError("Choose a non-empty attachment before saving.");
  }

  if (input.file.size > maxAttachmentBytes) {
    throw new AttachmentStorageError("Attachments must be 8 MB or smaller.");
  }

  if (!allowedExtensions.has(extension) && !normalizedType.startsWith("image/")) {
    throw new AttachmentStorageError("Attachments must be a PDF, image, text file, or CSV.");
  }

  if (!allowedMimeTypes.has(normalizedType) && !normalizedType.startsWith("image/")) {
    throw new AttachmentStorageError("This attachment type is not supported.");
  }

  const safeCategory = sanitizeSegment(input.category) || "general";
  const originalBaseName = path.basename(originalName, extension) || "attachment";
  const safeBaseName = sanitizeSegment(originalBaseName) || "attachment";
  const safeOriginalName = sanitizeFileName(originalName) || `attachment${extension || ".txt"}`;
  const storedFileName = `${Date.now()}-${randomUUID().slice(0, 8)}-${safeBaseName}${extension || ".txt"}`;
  const relativePath = path.posix.join(...attachmentRootSegments, safeCategory, storedFileName);
  const storageUrl = `/${relativePath}`;
  const absolutePath = buildAttachmentAbsolutePath(storageUrl);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, Buffer.from(await input.file.arrayBuffer()));

  return {
    label: input.label?.trim() || safeOriginalName,
    fileName: safeOriginalName,
    fileType: normalizedType,
    storageUrl,
  };
}

export async function removeStoredAttachment(storageUrl: string) {
  if (!storageUrl.startsWith("/uploads/attachments/")) {
    return;
  }

  await rm(buildAttachmentAbsolutePath(storageUrl), { force: true });
}

export async function clearStoredAttachments() {
  await rm(path.join(process.cwd(), "public", ...attachmentRootSegments), {
    recursive: true,
    force: true,
  });
}
