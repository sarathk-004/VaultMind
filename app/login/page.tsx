import { LoginCarousel } from "@/components/vaultmind/login-carousel"
import { LoginPanel } from "@/components/vaultmind/login-panel"
import { MobileLoginFlow } from "@/components/vaultmind/mobile-login-flow"

interface LoginPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams
  const notion = typeof params?.notion === "string" ? params.notion : undefined
  const reason = typeof params?.reason === "string" ? params.reason : undefined

  return (
    <main className="min-h-screen overflow-hidden bg-[#191919] text-[#FAFAFA]">
      <div className="md:hidden">
        <MobileLoginFlow notion={notion} reason={reason} />
      </div>
      <div className="hidden min-h-screen md:grid md:grid-cols-[58.6%_41.4%]">
        <LoginCarousel />
        <LoginPanel notion={notion} reason={reason} />
      </div>
    </main>
  )
}
