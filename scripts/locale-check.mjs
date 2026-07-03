import fs from "node:fs"
import path from "node:path"

const root = path.join(process.cwd(), "locales")
const zhDir = path.join(root, "zh")
const enDir = path.join(root, "en")

function loadKeys(dir) {
  const keys = new Set()
  if (!fs.existsSync(dir)) return keys
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".json")) continue
    const data = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"))
    for (const k of Object.keys(data)) keys.add(k)
  }
  return keys
}

const zh = loadKeys(zhDir)
const en = loadKeys(enDir)
const missingEn = [...zh].filter((k) => !en.has(k))
const missingZh = [...en].filter((k) => !zh.has(k))

if (missingEn.length || missingZh.length) {
  console.error("Locale key mismatch:")
  if (missingEn.length) console.error("  Missing in en:", missingEn.join(", "))
  if (missingZh.length) console.error("  Missing in zh:", missingZh.join(", "))
  process.exit(1)
}
console.log(`Locale check OK (${zh.size} keys)`)
