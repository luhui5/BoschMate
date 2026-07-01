export type ThinkingDepth =
  | "default"
  | "low"
  | "medium"
  | "high"
  | "extra-high"
  | "max"
  | "ultracode"

export interface ThinkingDepthOption {
  id: ThinkingDepth
  label: string
  desc: string
}

export const THINKING_DEPTHS: ThinkingDepthOption[] = [
  { id: "default", label: "Default", desc: "均衡速度与质量，适合日常任务" },
  { id: "low", label: "Low", desc: "最快响应，适合简单问答" },
  { id: "medium", label: "Medium", desc: "适度推理，兼顾效率" },
  { id: "high", label: "High", desc: "更深入的分步推理" },
  { id: "extra-high", label: "Extra High", desc: "复杂问题的强化推理" },
  { id: "max", label: "Max", desc: "最大化推理预算，耗时更长" },
  { id: "ultracode", label: "Ultracode", desc: "面向大型代码库的极限推理模式" },
]

export function getThinkingDepth(id: ThinkingDepth): ThinkingDepthOption {
  return THINKING_DEPTHS.find((d) => d.id === id) ?? THINKING_DEPTHS[0]
}
