export function scrollContainerToBottom(
  el: HTMLElement,
  behavior: ScrollBehavior = "instant",
) {
  el.scrollTo({ top: el.scrollHeight, behavior })
}

export function isNearBottom(el: HTMLElement, threshold = 96): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold
}
