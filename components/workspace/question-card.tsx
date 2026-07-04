"use client"

import { useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, MessageCircleQuestion } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { AskUserQuestion, PendingQuestions, QuestionAnswer } from "@/lib/types"

const OTHER_ID = "other"

type DisplayOption = { id: string; label: string; recommended?: boolean }

function isOtherOption(opt: { id: string; label: string }): boolean {
  return opt.id.toLowerCase() === OTHER_ID || opt.label.toLowerCase() === "other"
}

function stripRecommendedSuffix(label: string): string {
  return label.replace(/\s*\(Recommended\)\s*$/i, "").trim()
}

/** Model provides 3 options; UI always adds exactly one Other → 4 total. */
function normalizeOptions(question: AskUserQuestion): DisplayOption[] {
  const modelOptions = question.options.filter((o) => !isOtherOption(o)).slice(0, 3)
  const normalized: DisplayOption[] = modelOptions.map((opt, index) => ({
    id: opt.id,
    label: stripRecommendedSuffix(opt.label),
    recommended: index === 0 || /\(Recommended\)/i.test(opt.label),
  }))
  normalized.push({ id: OTHER_ID, label: "Other" })
  return normalized
}

function selectionIncludesOther(selected: string[]): boolean {
  return selected.includes(OTHER_ID)
}

function isQuestionComplete(
  q: AskUserQuestion,
  selection: Record<string, string[]>,
  otherText: Record<string, string>,
): boolean {
  const sel = selection[q.id] ?? []
  if (sel.length === 0) return false
  if (selectionIncludesOther(sel) && !otherText[q.id]?.trim()) return false
  return true
}

type SelectionState = Record<string, string[]>
type OtherTextState = Record<string, string>

function defaultSelectionForQuestions(questions: AskUserQuestion[]): SelectionState {
  const selection: SelectionState = {}
  for (const q of questions) {
    const options = normalizeOptions(q)
    const recommended =
      options.find((o) => o.recommended && o.id !== OTHER_ID) ??
      options.find((o) => o.id !== OTHER_ID)
    if (recommended) selection[q.id] = [recommended.id]
  }
  return selection
}

export function QuestionCard({
  pending,
  onSubmit,
  disabled,
}: {
  pending: PendingQuestions
  onSubmit: (answers: QuestionAnswer[]) => void
  disabled?: boolean
}) {
  const [selection, setSelection] = useState<SelectionState>(() =>
    defaultSelectionForQuestions(pending.questions),
  )
  const [otherText, setOtherText] = useState<OtherTextState>(() => ({}))
  const [currentIndex, setCurrentIndex] = useState(0)

  const answered = pending.status === "answered"
  const total = pending.questions.length
  const currentQuestion = pending.questions[currentIndex]

  const canSubmit = useMemo(() => {
    if (answered || disabled) return false
    return pending.questions.every((q) =>
      isQuestionComplete(q, selection, otherText),
    )
  }, [answered, disabled, pending.questions, selection, otherText])

  const currentComplete = currentQuestion
    ? isQuestionComplete(currentQuestion, selection, otherText)
    : false

  const toggleOption = (q: AskUserQuestion, optionId: string) => {
    if (answered || disabled) return
    setSelection((prev) => ({ ...prev, [q.id]: [optionId] }))
  }

  const goPrev = () => setCurrentIndex((i) => Math.max(0, i - 1))
  const goNext = () => {
    if (!currentComplete) return
    setCurrentIndex((i) => Math.min(total - 1, i + 1))
  }

  const handleSubmit = () => {
    if (!canSubmit) return
    const answers: QuestionAnswer[] = pending.questions.map((q) => ({
      question_id: q.id,
      selected_option_ids: selection[q.id] ?? [],
      other_text: selectionIncludesOther(selection[q.id] ?? [])
        ? otherText[q.id]?.trim() || undefined
        : undefined,
    }))
    onSubmit(answers)
  }

  return (
    <div className="w-full overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-card px-3 py-2">
        <div className="flex items-center gap-2">
          <MessageCircleQuestion className="size-4 shrink-0 text-primary" />
          <span className="text-sm font-medium">
            {answered ? "已回答" : "请确认以下问题"}
          </span>
        </div>
        {!answered && total > 1 && (
          <span className="text-xs text-muted-foreground">
            {currentIndex + 1} / {total}
          </span>
        )}
      </div>

      <div className="p-3">
        {answered ? (
          <div className="space-y-3">
            {pending.questions.map((q) => (
              <QuestionBlock
                key={q.id}
                question={q}
                selected={[]}
                otherValue=""
                answered
                answer={pending.answers?.find((a) => a.question_id === q.id)}
                onToggle={() => {}}
                onOtherChange={() => {}}
              />
            ))}
          </div>
        ) : (
          <>
            {total > 1 && (
              <div className="mb-3 flex justify-center gap-1.5">
                {pending.questions.map((q, i) => (
                  <button
                    key={q.id}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      if (i <= currentIndex || isQuestionComplete(q, selection, otherText)) {
                        setCurrentIndex(i)
                      }
                    }}
                    className={cn(
                      "size-2 rounded-full transition-colors",
                      i === currentIndex
                        ? "bg-primary"
                        : isQuestionComplete(q, selection, otherText)
                          ? "bg-primary/40"
                          : "bg-muted-foreground/30",
                      disabled && "cursor-not-allowed",
                    )}
                    aria-label={`问题 ${i + 1}`}
                  />
                ))}
              </div>
            )}

            {currentQuestion && (
              <QuestionBlock
                question={currentQuestion}
                selected={selection[currentQuestion.id] ?? []}
                otherValue={otherText[currentQuestion.id] ?? ""}
                answered={false}
                disabled={disabled}
                onToggle={(optionId) => toggleOption(currentQuestion, optionId)}
                onOtherChange={(text) =>
                  setOtherText((prev) => ({ ...prev, [currentQuestion.id]: text }))
                }
              />
            )}

            <div className="mt-4 flex items-center justify-between gap-2">
              {total > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={currentIndex === 0 || disabled}
                  onClick={goPrev}
                >
                  <ChevronLeft className="size-4" />
                  上一题
                </Button>
              ) : (
                <span />
              )}

              {currentIndex < total - 1 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={!currentComplete || disabled}
                  onClick={goNext}
                >
                  下一题
                  <ChevronRight className="size-4" />
                </Button>
              ) : (
                <Button size="sm" disabled={!canSubmit} onClick={handleSubmit}>
                  提交回答
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function QuestionBlock({
  question,
  selected,
  otherValue,
  answered,
  disabled,
  answer,
  onToggle,
  onOtherChange,
}: {
  question: AskUserQuestion
  selected: string[]
  otherValue: string
  answered: boolean
  disabled?: boolean
  answer?: QuestionAnswer
  onToggle: (optionId: string) => void
  onOtherChange: (text: string) => void
}) {
  const options = normalizeOptions(question)

  if (answered && answer) {
    const labels = answer.selected_option_ids.map((id) => {
      if (id === OTHER_ID) {
        return answer.other_text ? `Other: ${answer.other_text}` : "Other"
      }
      const opt = question.options.find((o) => o.id === id)
      return opt ? stripRecommendedSuffix(opt.label) : id
    })
    return (
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{question.prompt}</p>
        <p className="text-sm text-muted-foreground">{labels.join(" · ")}</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-foreground">{question.prompt}</p>
      <div className="flex flex-col gap-1.5">
        {options.map((opt) => {
          const isSelected = selected.includes(opt.id)
          const showOtherInput = opt.id === OTHER_ID && isSelected
          return (
            <div key={`${question.id}-${opt.id}`}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onToggle(opt.id)}
                className={cn(
                  "w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
                  isSelected
                    ? "border-primary bg-primary/10 text-foreground"
                    : opt.recommended
                      ? "border-primary/50 bg-card hover:bg-accent"
                      : "border-border bg-card hover:bg-accent",
                  disabled && "cursor-not-allowed opacity-60",
                )}
              >
                <span className="flex items-center gap-2">
                  {opt.recommended && (
                    <span className="shrink-0 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                      建议
                    </span>
                  )}
                  <span>{opt.label}</span>
                </span>
              </button>
              {showOtherInput && (
                <input
                  type="text"
                  value={otherValue}
                  disabled={disabled}
                  onChange={(e) => onOtherChange(e.target.value)}
                  placeholder="请说明…"
                  className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
