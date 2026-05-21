import { BrandMark } from "@/components/brand/brand-mark"
import { LoginPanel } from "@/components/vaultmind/login-panel"

interface LoginPageProps {
  searchParams?: Record<string, string | string[] | undefined>
}

export default function LoginPage({ searchParams }: LoginPageProps) {
  const notion = typeof searchParams?.notion === "string" ? searchParams.notion : undefined
  const reason = typeof searchParams?.reason === "string" ? searchParams.reason : undefined

  return (
    <main className="relative min-h-screen overflow-hidden bg-background">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(900px_circle_at_18%_12%,rgba(217,89,42,0.2),transparent_55%),radial-gradient(820px_circle_at_82%_78%,rgba(206,203,246,0.25),transparent_60%)]" />
      <div className="pointer-events-none absolute -left-24 top-12 h-56 w-56 rounded-full bg-[rgba(217,89,42,0.22)] blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-140px] right-[-40px] h-80 w-80 rounded-full bg-[rgba(63,58,58,0.25)] blur-[90px]" />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-6xl flex-col gap-10 px-6 py-12 md:py-16">
        <header className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.4em] text-muted-foreground">
          <BrandMark className="h-8 w-8" alt="Graphyne" />
          Graphyne
        </header>

        <section className="grid flex-1 items-center gap-10 md:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card/70 px-3 py-1 text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
              Notion-first access
            </div>
            <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              Your Notion workspace, mapped in minutes.
            </h1>
            <p className="max-w-xl text-base text-muted-foreground">
              Graphyne reads live pages from your Notion workspace, builds a living knowledge graph,
              and keeps every answer grounded in real data.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              {[
                "No tokens. No setup. Just Notion OAuth.",
                "Pick the exact pages Graphyne can read.",
                "Realtime graph updates as you ask questions.",
                "Disconnect anytime and clear access instantly.",
              ].map(item => (
                <div
                  key={item}
                  className="rounded-xl border border-border/60 bg-card/70 p-3 text-xs text-muted-foreground"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>

          <LoginPanel notion={notion} reason={reason} />
        </section>

        <footer className="text-[11px] text-muted-foreground">
          By continuing you agree to authorize Graphyne to access the pages you select in Notion.
        </footer>
      </div>
    </main>
  )
}
