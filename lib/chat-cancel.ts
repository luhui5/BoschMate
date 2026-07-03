export function isChatCancelled(err: unknown): boolean {
  const msg = String(err)
  return msg.includes('CHAT_CANCELLED')
}
