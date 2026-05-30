import { createClient, type RedisClientType } from "redis"
import type { StackerCacheAdapter } from "./types"

let client: RedisClientType | null = null
let connecting: Promise<RedisClientType> | null = null

async function getClient(): Promise<RedisClientType> {
  if (!process.env.REDIS_URL) throw new Error("REDIS_URL is required for the Redis adapter")
  if (client?.isOpen) return client
  if (!connecting) {
    client = createClient({ url: process.env.REDIS_URL })
    client.on("error", error => {
      console.warn("[stacker] Redis client error:", error)
    })
    connecting = client.connect().then(() => client!)
  }
  return connecting
}

export const redisCacheAdapter: StackerCacheAdapter = {
  async get<T>(key: string): Promise<T | null> {
    const redis = await getClient()
    const raw = await redis.get(key)
    if (!raw) return null
    try {
      return JSON.parse(raw) as T
    } catch {
      return null
    }
  },

  async set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    const redis = await getClient()
    await redis.set(key, JSON.stringify(value), { PX: ttlMs })
  },
}
