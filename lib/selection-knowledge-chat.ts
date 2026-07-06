import { buildAssistantSystemPrompt } from "@/lib/assistant-prompt"
import { createPersistedSession, deriveTitle } from "@/lib/assistant-sessions"
import { ensureHomeWorkspace } from "@/lib/assistant-workspaces"
import { buildLlmMessages } from "@/lib/chat-history"
import {
  findModel,
  loadApiKey,
  loadModels,
  recordModelUsage,
  resolveDefaultModelForNewSession,
} from "@/lib/models"
import {
  aiLoopChat,
  mapActivityStep,
  onChatToken,
  onLoopActivity,
  sendMessage,
} from "@/lib/tauri-api"

export interface RunSelectionKnowledgeChatOptions {
  text: string
  kbaseId: string
  kbaseName: string
  onToken?: (content: string) => void
  onActivity?: (label: string) => void
}

export interface RunSelectionKnowledgeChatResult {
  sessionId: string
  messageId: string
  content: string
}

export async function runSelectionKnowledgeChat(
  opts: RunSelectionKnowledgeChatOptions,
): Promise<RunSelectionKnowledgeChatResult> {
  const home = await ensureHomeWorkspace()
  if (!home) {
    throw new Error("无法打开 Home 工作区")
  }

  const models = await loadModels()
  const modelId = await resolveDefaultModelForNewSession(models)
  const modelCfg = findModel(models, modelId)
  if (!modelCfg) {
    throw new Error("未配置模型，请前往 设置 → 模型配置")
  }

  const session = await createPersistedSession({
    projectId: home.projectId,
    title: deriveTitle(opts.text),
    folder: home.localPath,
  })

  await sendMessage({
    session_id: session.id,
    content: opts.text,
    mode: "ask",
  })

  const assistantMsgId = `a-${Date.now()}`
  const system = buildAssistantSystemPrompt({
    folder: home.localPath,
    toolsEnabled: true,
    mode: "ask",
    knowledgeSession: true,
    selectedKbaseName: opts.kbaseName,
  })

  const apiKey = (await loadApiKey(modelCfg.id)) ?? undefined
  const llmMessages = buildLlmMessages([], opts.text)

  let streamedContent = ""
  const unlistenToken = onChatToken((e) => {
    if (e.session_id !== session.id || e.message_id !== assistantMsgId) return
    streamedContent += e.delta
    opts.onToken?.(streamedContent)
  })

  const unlistenActivity = onLoopActivity((e) => {
    if (e.session_id !== session.id || e.message_id !== assistantMsgId) return
    const step = mapActivityStep(e.step)
    if (step.kind === "thought" && step.status === "running") {
      streamedContent = ""
    }
    opts.onActivity?.(step.label)
  })

  try {
    const response = await aiLoopChat(
      {
        provider: modelCfg.backend,
        model: modelCfg.name,
        messages: llmMessages,
        system_prompt: system,
        api_key: apiKey,
        base_url: modelCfg.endpoint ?? undefined,
        skip_tls_verify: modelCfg.skipTlsVerify ?? false,
        assistant_mode: true,
        agent_mode: "ask",
        edit_dry_run: false,
        enabled_kbase_ids: [opts.kbaseId],
      },
      session.id,
      home.projectId,
      assistantMsgId,
    )
    await recordModelUsage(modelCfg.id)
    return {
      sessionId: session.id,
      messageId: response.id,
      content: response.content || streamedContent,
    }
  } finally {
    unlistenToken()
    unlistenActivity()
  }
}
