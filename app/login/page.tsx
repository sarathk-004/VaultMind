import { LoginCarousel } from "@/components/vaultmind/login-carousel"
import { LoginPanel } from "@/components/vaultmind/login-panel"
import { MobileLoginFlow } from "@/components/vaultmind/mobile-login-flow"

interface LoginPageProps {
  searchParams?: Record<string, string | string[] | undefined>
}

export default function LoginPage({ searchParams }: LoginPageProps) {
  const notion = typeof searchParams?.notion === "string" ? searchParams.notion : undefined
  const reason = typeof searchParams?.reason === "string" ? searchParams.reason : undefined

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
