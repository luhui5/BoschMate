export const BOSCH_COLORS = [
  "#8B0000",
  "#DC143C",
  "#800080",
  "#00008B",
  "#4169E1",
  "#006400",
  "#2E8B57",
] as const

export const BOSCH_GRADIENT = `linear-gradient(to right, ${BOSCH_COLORS.join(", ")})`

export const BOSCH_CONIC_GRADIENT = `conic-gradient(from 0deg, ${[...BOSCH_COLORS, BOSCH_COLORS[0]].join(", ")})`
