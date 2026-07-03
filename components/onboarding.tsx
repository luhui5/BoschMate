"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { Rocket, Bot, FolderOpen, Lightbulb, ChevronRight, ChevronLeft } from "lucide-react"
import { useApp } from "@/components/app-provider"

interface OnboardingProps {
  onComplete: () => void
  onSkip: () => void
}

export function OnboardingWizard({ onComplete, onSkip }: OnboardingProps) {
  const { t } = useApp()
  const [step, setStep] = useState(0)
  const totalSteps = 4

  const steps = [
    {
      title: t ? t("onboarding.welcome.title") : "Welcome to BoschCode",
      icon: Rocket,
      content: (
        <div className="space-y-3 text-center">
          <p className="text-lg font-semibold">
            {t ? t("onboarding.welcome.subtitle") : "Your Local AI Coding Assistant"}
          </p>
          <ul className="text-sm text-muted-foreground space-y-1.5 text-left mx-auto max-w-xs">
            <li>· Code stays local, no internet required</li>
            <li>· Long-term memory, learns your project</li>
            <li>· Switch from Q&A to full automation freely</li>
          </ul>
        </div>
      ),
    },
    {
      title: t ? t("onboarding.model.title") : "Choose AI Model",
      icon: Bot,
      content: (
        <div className="space-y-3">
          <label className="flex items-center gap-2 cursor-pointer rounded-lg border p-3 hover:bg-accent">
            <input type="radio" name="model" defaultChecked className="mt-0.5" />
            <div>
              <div className="font-medium">Local Model (Ollama)</div>
              <div className="text-xs text-muted-foreground">Free, offline, requires setup</div>
            </div>
          </label>
          <label className="flex items-center gap-2 cursor-pointer rounded-lg border p-3 hover:bg-accent">
            <input type="radio" name="model" className="mt-0.5" />
            <div>
              <div className="font-medium">Cloud API (Anthropic / OpenAI)</div>
              <div className="text-xs text-muted-foreground">Better quality, requires API key</div>
            </div>
          </label>
          <label className="flex items-center gap-2 cursor-pointer rounded-lg border p-3 hover:bg-accent">
            <input type="radio" name="model" className="mt-0.5" />
            <div>
              <div className="font-medium">Skip for now</div>
              <div className="text-xs text-muted-foreground">Configure later in Settings</div>
            </div>
          </label>
        </div>
      ),
    },
    {
      title: t ? t("onboarding.project.title") : "Open Your First Project",
      icon: FolderOpen,
      content: (
        <div className="space-y-3 text-center">
          <p className="text-sm text-muted-foreground">
            Select a local directory to get started
          </p>
          <div className="flex flex-col gap-2">
            <Button variant="outline" className="w-full justify-start gap-2">
              <FolderOpen className="h-4 w-4" />
              Choose Local Directory
            </Button>
            <Button variant="outline" className="w-full justify-start gap-2">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M16 12l-4-4-4 4M8 16l4-4 4 4" />
              </svg>
              Clone Git Repository
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">You can always add projects later</p>
        </div>
      ),
    },
    {
      title: t ? t("onboarding.tour.title") : "Quick Tour",
      icon: Lightbulb,
      content: (
        <div className="space-y-3 text-center">
          <p className="text-sm text-muted-foreground">
            Your workspace has three areas:
          </p>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded-lg border p-2">
              <div className="font-medium">← Left</div>
              <div className="text-muted-foreground">Sessions & Memory</div>
            </div>
            <div className="rounded-lg border p-2 ring-2 ring-primary">
              <div className="font-medium">↕ Center</div>
              <div className="text-muted-foreground">Chat & Commands</div>
            </div>
            <div className="rounded-lg border p-2">
              <div className="font-medium">→ Right</div>
              <div className="text-muted-foreground">Files & Git</div>
            </div>
          </div>
          <p className="text-sm font-medium">
            Try typing: "What does this project do?"
          </p>
        </div>
      ),
    },
  ]

  const CurrentIcon = steps[step].icon

  return (
    <Modal open title={steps[step].title} onClose={onSkip}>
      <div className="max-w-md mx-auto py-6 px-2">
        {/* Progress dots */}
        <div className="flex justify-center gap-1.5 mb-6">
          {steps.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? "w-6 bg-primary" : i < step ? "w-1.5 bg-primary/50" : "w-1.5 bg-border"
              }`}
            />
          ))}
        </div>

        {/* Icon */}
        <div className="flex justify-center mb-4">
          <div className="p-3 rounded-full bg-primary/10">
            <CurrentIcon className="h-8 w-8 text-primary" />
          </div>
        </div>

        {/* Title */}
        <h2 className="text-xl font-bold text-center mb-4">{steps[step].title}</h2>

        {/* Content */}
        <div className="min-h-[150px]">{steps[step].content}</div>

        {/* Navigation */}
        <div className="flex justify-between items-center mt-6">
          <div>
            {step > 0 ? (
              <Button variant="ghost" size="sm" onClick={() => setStep(step - 1)}>
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={onSkip}>
                Skip All
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            {step < totalSteps - 1 ? (
              <Button size="sm" onClick={() => setStep(step + 1)}>
                Next
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            ) : (
              <Button size="sm" onClick={onComplete}>
                Get Started
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  )
}
