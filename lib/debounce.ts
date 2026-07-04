export type DebouncedFunction<T extends (...args: never[]) => void> = T & {
  cancel: () => void
}

export function debounce<T extends (...args: never[]) => void>(
  fn: T,
  ms: number,
): DebouncedFunction<T> {
  let timer: ReturnType<typeof setTimeout> | null = null

  const debounced = ((...args: Parameters<T>) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn(...args)
    }, ms)
  }) as DebouncedFunction<T>

  debounced.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  return debounced
}
