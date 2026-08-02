import { cn } from "@/lib/utils"

function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-background px-2.5 py-1 text-sm shadow-sm transition-colors",
        "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  )
}

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex w-full rounded-md border border-input bg-background px-2.5 py-2 text-sm shadow-sm transition-colors",
        "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50 resize-none scrollbar-thin",
        className,
      )}
      {...props}
    />
  )
}

export { Input, Textarea }
