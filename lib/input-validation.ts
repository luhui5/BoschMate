/** User input limits per requirements §3.5.5 */

export const MAX_MESSAGE_BYTES = 64 * 1024
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export interface ValidationResult {
  ok: boolean
  error?: string
}

export function validateMessage(text: string): ValidationResult {
  const bytes = new TextEncoder().encode(text).length
  if (bytes > MAX_MESSAGE_BYTES) {
    return {
      ok: false,
      error: `消息过长（${(bytes / 1024).toFixed(1)} KB），上限为 ${MAX_MESSAGE_BYTES / 1024} KB`,
    }
  }
  return { ok: true }
}

export function validateImageDataUrl(dataUrl: string): ValidationResult {
  const base64 = dataUrl.split(",")[1] ?? ""
  const approxBytes = Math.floor((base64.length * 3) / 4)
  if (approxBytes > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      error: `图片过大（约 ${(approxBytes / (1024 * 1024)).toFixed(1)} MB），上限为 10 MB`,
    }
  }
  return { ok: true }
}
