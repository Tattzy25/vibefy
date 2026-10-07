import type { Model } from "../upstream-types"

const MODELS_DEV_URL = "https://models.dev/api.json"
const CACHE_TTL = 60 * 60 * 1000 // 1 hour

let cached: Record<string, Model[]> | undefined
let cachedAt = 0

/**
 * Supported provider IDs we can actually route requests to.
 */
const SUPPORTED = new Set(["anthropic", "openai", "google"])

/**
 * Provider SDK metadata for the `api` field.
 */
const PROVIDER_API: Record<string, { url: string; npm: string }> = {
  anthropic: { url: "https://api.anthropic.com/v1", npm: "@ai-sdk/anthropic" },
  openai: { url: "https://api.openai.com/v1", npm: "@ai-sdk/openai" },
  google: { url: "https://generativelanguage.googleapis.com/v1beta", npm: "@ai-sdk/google" },
}

/**
 * Provider env var names.
 */
export const PROVIDER_ENV: Record<string, string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  google: ["GOOGLE_API_KEY"],
}

/**
 * Convert raw models.dev data into upstream-compatible Model shape.
 */
interface RawModel {
  id: string
  name: string
  family?: string
  reasoning?: boolean
  attachment?: boolean
  cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number }
  limit: { context: number; output: number }
  modalities?: { input?: string[]; output?: string[] }
  release_date?: string
  variants?: Record<string, Record<string, unknown>>
}

function toModel(pid: string, m: RawModel): Model {
  const api = PROVIDER_API[pid] || { url: "", npm: "" }
  const inp = m.modalities?.input || ["text"]
  const out = m.modalities?.output || ["text"]
  return {
    id: m.id,
    providerID: pid,
    name: m.name,
    family: m.family,
    api: { id: m.id, url: api.url, npm: api.npm },
    status: "active",
    headers: {},
    options: {},
    cost: {
      input: m.cost?.input ?? 0,
      output: m.cost?.output ?? 0,
      cache: { read: m.cost?.cache_read ?? 0, write: m.cost?.cache_write ?? 0 },
    },
    limit: { context: m.limit.context, output: m.limit.output },
    capabilities: {
      temperature: true,
      reasoning: !!m.reasoning,
      attachment: !!m.attachment,
      toolcall: true,
      input: { text: inp.includes("text"), audio: inp.includes("audio"), image: inp.includes("image"), video: inp.includes("video"), pdf: inp.includes("pdf") },
      output: { text: out.includes("text"), audio: out.includes("audio"), image: out.includes("image"), video: out.includes("video"), pdf: out.includes("pdf") },
      interleaved: false,
    },
    release_date: m.release_date || "",
    variants: m.variants,
  }
}

/**
 * Fetch models from models.dev and parse into Model shape.
 */
async function fetchModels(): Promise<Record<string, Model[]> | undefined> {
  try {
    const res = await fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return undefined
    const data = await res.json() as Record<string, {
      id: string
      name: string
      models: Record<string, RawModel>
    }>
    const result: Record<string, Model[]> = {}
    for (const [pid, provider] of Object.entries(data)) {
      if (!SUPPORTED.has(pid)) continue
      result[pid] = Object.values(provider.models).map((m) => toModel(pid, m))
    }
    return result
  } catch {
    return undefined
  }
}

/**
 * Get models for a provider. Tries cached models.dev data first,
 * falls back to static PROVIDER_MODELS.
 */
export async function getModels(pid: string): Promise<Record<string, Model>> {
  if (!cached || Date.now() - cachedAt > CACHE_TTL) {
    const fresh = await fetchModels()
    if (fresh) {
      cached = fresh
      cachedAt = Date.now()
    }
  }
  const list = cached?.[pid] ?? PROVIDER_MODELS[pid] ?? []
  const models: Record<string, Model> = {}
  for (const m of list) models[m.id] = m
  return models
}

/**
 * Static model catalog (fallback when models.dev fails).
 */
export const PROVIDER_MODELS: Record<string,  Model[]> = {
  anthropic: [
    toModel("anthropic", { id: "claude-sonnet-5-5", name: "Claude Sonnet 5.5", reasoning: true, attachment: true, cost: { input: 2, output: 10, cache_read: 0.2, cache_write: 4 }, limit: { context: 1000000, output: 128000 } }),
    toModel("anthropic", { id: "claude-fable-5-1", name: "Claude Fable 5.1", reasoning: true, attachment: true, cost: { input: 10, output: 50, cache_read: 0.25, cache_write: 20 }, limit: { context: 1000000, output: 128000 } }),
    toModel("anthropic", { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", attachment: true, cost: { input: 1, output: 5, cache_read: 0.1, cache_write: 2 }, limit: { context: 200000, output: 64000 } }),
  ],
  openai: [
    toModel("openai", { id: "gpt-6-astra", name: "GPT-6 Astra", attachment: true, cost: { input: 10, output: 50, cache_read: 1, cache_write: 12.5 }, limit: { context: 1050000, output: 128000 } }),
    toModel("openai", { id: "gpt-5.5", name: "GPT-5.5", attachment: true, cost: { input: 5, output: 30, cache_read: 0.5 }, limit: { context: 1050000, output: 128000 } }),
    toModel("openai", { id: "gpt-6.1-sol", name: "GPT-6.1 Sol", attachment: true, cost: { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 }, limit: { context: 1050000, output: 128000 } }),
    toModel("openai", { id: "gpt-5.4", name: "GPT-5.4", attachment: true, cost: { input: 2.5, output: 15, cache_read: 0.25 }, limit: { context: 1050000, output: 128000 } }),
  ],
  google: [
    toModel("google", { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", reasoning: true, attachment: true, cost: { input: 0.75, output: 3.75, cache_read: 0.075 }, limit: { context: 1048576, output: 65536 } }),
    toModel("google", { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash", reasoning: true, attachment: true, cost: { input: 0.75, output: 3.75, cache_read: 0.075 }, limit: { context: 1048576, output: 65536 } }),
  ],
}

export function buildModels(pid: string): Record<string, Model> {
  const models: Record<string, Model> = {}
  for (const m of (PROVIDER_MODELS[pid] ?? [])) models[m.id] = m
  return models
}

/**
 * Reset the models.dev cache (for testing).
 */
export function resetModelsCache() {
  cached = undefined
  cachedAt = 0
}
