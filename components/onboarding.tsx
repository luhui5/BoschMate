"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { projectPath } from "@/lib/project-route"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { Input } from "@/components/ui/input"
import { Rocket, Bot, FolderOpen, Lightbulb, ChevronRight, ChevronLeft } from "lucide-react"
import { useApp } from "@/components/app-provider"
import {
  isTauri,
  pickFolder,
  createProject,
  gitCloneRepo,
  setSetting,
} from "@/lib/tauri-api"
import { pickAndOpenLocalProject, projectNameFromPath } from "@/lib/open-local-project"
import { DEFAULT_MODELS, saveModels, type ModelConfig } from "@/lib/models"

interface OnboardingProps {
  onComplete: () => void
  onSkip: () => void
}

type ModelChoice = "ollama" | "cloud" | "skip"

export function OnboardingWizard({ onComplete, onSkip }: OnboardingProps) {
  const { t } = useApp()
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [modelChoice, setModelChoice] = useState<ModelChoice>("ollama")
  const [gitUrl, setGitUrl] = useState("")
  const [showClone, setShowClone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const totalSteps = 4

  const saveModelChoice = async () => {
    if (modelChoice === "skip") return
    const models: ModelConfig[] =
      modelChoice === "ollama"
        ? DEFAULT_MODELS
        : [
            {
              id: "cloud-default",
              name: "gpt-4o-mini",
              protocol: "openai",
              provider: "openai",
              detail: "云端 API（请在设置中配置 API Key）",
              endpoint: "https://api.openai.com/v1",
              contextWindow: 128000,
              temperature: 0.3,
            },
          ]
    await saveModels(models)
  }

  const openLocalFolder = async () => {
    if (!isTauri()) {
      setError("请在桌面应用中使用此功能")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const project = await pickAndOpenLocalProject()
      if (!project) return
      await setSetting("onboarding_completed", "true")
      onComplete()
      router.push(projectPath(project.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const cloneRepo = async () => {
    if (!isTauri()) {
      setError("请在桌面应用中使用此功能")
      return
    }
    if (!gitUrl.trim()) {
      setError("请输入 Git 仓库 URL")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const parent = await pickFolder()
      if (!parent) return
      const localPath = await gitCloneRepo(parent, gitUrl.trim())
      const project = await createProject({ name: projectNameFromPath(localPath), local_path: localPath })
      setShowClone(false)
      await setSetting("onboarding_completed", "true")
      onComplete()
      router.push(projectPath(project.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const goNext = async () => {
    if (step === 1) {
      setBusy(true)
      try {
        await saveModelChoice()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
        setBusy(false)
        return
      }
      setBusy(false)
    }
    setStep(step + 1)
  }

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
          {(
            [
              ["ollama", "Local Model (Ollama)", "Free, offline, requires setup"],
              ["cloud", "Cloud API (Anthropic / OpenAI)", "Better quality, requires API key"],
              ["skip", "Skip for now", "Configure later in Settings"],
            ] as const
          ).map(([id, title, desc]) => (
            <label
              key={id}
              className="flex items-center gap-2 cursor-pointer rounded-lg border p-3 hover:bg-accent"
            >
              <input
                type="radio"
                name="model"
                checked={modelChoice === id}
                onChange={() => setModelChoice(id)}
                className="mt-0.5"
              />
              <div>
                <div className="font-medium">{title}</div>
                <div className="text-xs text-muted-foreground">{desc}</div>
              </div>
            </label>
          ))}
        </div>
      ),
    },
    {
      title: t ? t("onboarding.project.title") : "Open Your First Project",
      icon: FolderOpen,
      content: (
        <div className="space-y-3 text-center">
          <p className="text-sm text-muted-foreground">Select a local directory to get started</p>
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              className="w-full justify-start gap-2"
              disabled={busy}
              onClick={() => void openLocalFolder()}
            >
              <FolderOpen className="h-4 w-4" />
              Choose Local Directory
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start gap-2"
              disabled={busy}
              onClick={() => setShowClone(true)}
            >
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
          <p className="text-sm text-muted-foreground">Your workspace has three areas:</p>
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
          <p className="text-sm font-medium">Try typing: &quot;What does this project do?&quot;</p>
        </div>
      ),
    },
  ]

  const CurrentIcon = steps[step].icon

  return (
    <>
      <Modal open title={steps[step].title} onClose={onSkip}>
        <div className="max-w-md mx-auto py-6 px-2">
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

          <div className="flex justify-center mb-4">
            <div className="p-3 rounded-full bg-primary/10">
              <CurrentIcon className="h-8 w-8 text-primary" />
            </div>
          </div>

          <h2 className="text-xl font-bold text-center mb-4">{steps[step].title}</h2>
          <div className="min-h-[150px]">{steps[step].content}</div>
          {error && <p className="mt-2 text-center text-xs text-destructive">{error}</p>}

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
                <Button size="sm" onClick={() => void goNext()} disabled={busy}>
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

      {showClone && (
        <Modal open title="Clone Git Repository" onClose={() => setShowClone(false)}>
          <div className="space-y-3 py-2">
            <Input
              value={gitUrl}
              onChange={(e) => setGitUrl(e.target.value)}
              placeholder="https://github.com/user/repo.git"
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowClone(false)}>
                取消
              </Button>
              <Button size="sm" disabled={busy} onClick={() => void cloneRepo()}>
                克隆并打开
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
