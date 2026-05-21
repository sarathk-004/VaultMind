import { ImageResponse } from "next/og"

export const runtime = "edge"
export const alt = "Graphyne - AI-powered Notion workspace assistant"
export const size = {
	width: 1200,
	height: 630,
}
export const contentType = "image/png"

export default function TwitterImage() {
	return new ImageResponse(
		(
			<div
				style={{
					height: "100%",
					width: "100%",
					display: "flex",
					flexDirection: "column",
					justifyContent: "space-between",
					padding: "64px",
					background:
						"radial-gradient(circle at 20% 20%, rgba(217, 89, 42, 0.28), transparent 35%), radial-gradient(circle at 82% 18%, rgba(206, 203, 246, 0.34), transparent 32%), linear-gradient(135deg, #121212 0%, #1d1b1b 52%, #0f0f10 100%)",
					color: "#f5f2ef",
					fontFamily:
						'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
				}}
			>
				<div style={{ display: "flex", alignItems: "center", gap: 20 }}>
					<div
						style={{
							width: 92,
							height: 92,
							borderRadius: 28,
							background: "rgba(255,255,255,0.08)",
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							border: "1px solid rgba(255,255,255,0.14)",
						}}
					>
						<div
							style={{
								width: 56,
								height: 56,
								borderRadius: 18,
								background: "linear-gradient(135deg, #d9592a 0%, #f6c4ae 100%)",
								boxShadow: "0 20px 60px rgba(217, 89, 42, 0.35)",
							}}
						/>
					</div>
					<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
						<div style={{ fontSize: 28, letterSpacing: "0.28em", textTransform: "uppercase", color: "#cecbf6" }}>
							Graphyne
						</div>
						<div style={{ fontSize: 22, color: "rgba(245, 242, 239, 0.84)" }}>
							Notion search, answers, and live knowledge graphs
						</div>
					</div>
				</div>

				<div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 40 }}>
					<div style={{ maxWidth: 760, fontSize: 54, lineHeight: 1.05, fontWeight: 700, letterSpacing: "-0.04em" }}>
						Your Notion workspace, mapped in real time.
					</div>
					<div
						style={{
							fontSize: 18,
							color: "rgba(245, 242, 239, 0.72)",
							textAlign: "right",
							maxWidth: 260,
						}}
					>
						AI-powered workspace assistant with a sharp, brand-first preview.
					</div>
				</div>
			</div>
		),
		size,
	)
}
