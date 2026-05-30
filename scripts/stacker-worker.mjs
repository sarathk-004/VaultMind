const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
const intervalMs = Number(process.env.STACKER_WORKER_INTERVAL_MS ?? 5 * 60_000)

async function syncOnce() {
  const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/vaultmind/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  })
  const body = await res.text()
  if (!res.ok) throw new Error(`Sync failed with ${res.status}: ${body}`)
  console.log(`[stacker-worker] ${new Date().toISOString()} ${body}`)
}

await syncOnce().catch(error => {
  console.error("[stacker-worker]", error)
})

setInterval(() => {
  syncOnce().catch(error => {
    console.error("[stacker-worker]", error)
  })
}, intervalMs)
