"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { LoginArrow } from "./login-arrow"

const SLIDES = [
  {
    image: "/login-carousel/knowledge-connected.svg",
    title: "Your Knowledge\nConnected!",
  },
  {
    image: "/login-carousel/answers-grounded.svg",
    title: "reads live pages\nfrom your notion\nworkspace",
  },
  {
    image: "/login-carousel/workspace-mapped.svg",
    title: "builds a living\nknowledge graph",
  },
  {
    image: "/login-carousel/ideas-linked.png",
    title: "keeps every answer\ngrounded in real data",
  },
]

export function LoginCarousel() {
  const [index, setIndex] = useState(0)
  const slide = SLIDES[index]

  const go = (direction: -1 | 1) => {
    setIndex(current => (current + direction + SLIDES.length) % SLIDES.length)
  }

  return (
    <section
      className="relative h-full min-h-[420px] overflow-hidden bg-[#645DBE] md:min-h-screen"
      aria-label="Graphyne login carousel"
    >
      <img
        key={slide.image}
        src={slide.image}
        alt=""
        className="login-carousel-art absolute inset-0 h-full w-full object-contain md:object-cover"
        draggable={false}
      />

      <div className="absolute inset-0 flex items-center justify-center px-10">
        <h1
          key={slide.title}
          className={
            "login-carousel-title whitespace-pre-line text-center font-mono font-black tracking-[-0.03em] text-[#FAFAFA] " +
            (index === 0
              ? "max-w-[660px] text-[clamp(2.25rem,4.8vw,3.85rem)] leading-[1.02] md:leading-[0.92]"
              : "max-w-[560px] text-[clamp(1.7rem,3.35vw,2.75rem)] lowercase leading-[1.08] md:leading-[0.98]")
          }
        >
          {slide.title}
        </h1>
      </div>

      <div className="absolute inset-x-7 top-1/2 flex -translate-y-1/2 items-center justify-between">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="login-carousel-control h-12 w-12 rounded-md bg-[#AFA9EC] text-[#3F3A3A] hover:bg-[#FAFAFA] hover:text-[#3F3A3A] active:bg-[#FAFAFA]"
          onClick={() => go(-1)}
          aria-label="Previous carousel slide"
        >
          <LoginArrow direction="left" className="h-1/2 w-1/2"/>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="login-carousel-control h-12 w-12 rounded-md bg-[#AFA9EC] text-[#3F3A3A] hover:bg-[#FAFAFA] hover:text-[#3F3A3A] active:bg-[#FAFAFA]"
          onClick={() => go(1)}
          aria-label="Next carousel slide"
        >
          <LoginArrow direction="right" className="h-14 w-14" />
        </Button>
      </div>

      <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 gap-2" aria-hidden>
        {SLIDES.map((item, slideIndex) => (
          <span
            key={item.image}
            className={
              "h-1.5 rounded-full transition-all " +
              (slideIndex === index ? "w-6 bg-white" : "w-1.5 bg-white/45")
            }
          />
        ))}
      </div>
    </section>
  )
}

export function LoginIntroSlide({ className = "" }: { className?: string }) {
  const slide = SLIDES[0]

  return (
    <section
      className={"relative h-full min-h-[100dvh] overflow-hidden bg-[#645DBE] " + className}
      aria-label="Graphyne intro"
    >
      <img
        src={slide.image}
        alt=""
        className="login-carousel-art absolute inset-0 h-full w-full object-contain md:object-cover"
        draggable={false}
      />
      <div className="absolute inset-0 flex items-center justify-center px-10">
        <h1 className="login-carousel-title max-w-[660px] whitespace-pre-line text-center font-mono text-[clamp(1.85rem,10vw,3.2rem)] font-black leading-[1.02] tracking-[-0.03em] text-[#FAFAFA] sm:text-[clamp(2.1rem,12vw,3.5rem)] md:text-[clamp(2.25rem,14vw,3.85rem)] md:leading-[0.98]">
          {slide.title}
        </h1>
      </div>
    </section>
  )
}
