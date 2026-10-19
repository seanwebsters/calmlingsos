"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity, BarChart3, BookOpen, Boxes, CalendarDays, CheckCircle2, Clapperboard, Film, Gamepad2, Handshake, Library, Megaphone, Music2, Settings, Sparkles, Users,
} from "lucide-react";
import { cn } from "@/lib/cn";

export const NAV = [
  { n: "01", href: "/mission", label: "Mission Control", icon: Activity },
  { n: "02", href: "/characters", label: "Character Universe", icon: Users },
  { n: "03", href: "/references", label: "Reference Library", icon: Library },
  { n: "04", href: "/social", label: "Social Studio", icon: Clapperboard },
  { n: "05", href: "/animation", label: "Animation Studio", icon: Film },
  { n: "06", href: "/game", label: "Game Studio", icon: Gamepad2 },
  { n: "07", href: "/product", label: "Product Lab", icon: Boxes },
  { n: "08", href: "/story", label: "Story & World Studio", icon: BookOpen },
  { n: "09", href: "/music", label: "Music & Audio", icon: Music2 },
  { n: "10", href: "/marketing", label: "Marketing Studio", icon: Megaphone },
  { n: "11", href: "/licensing", label: "Licensing Studio", icon: Handshake },
  { n: "12", href: "/agents", label: "Agent Headquarters", icon: Sparkles },
  { n: "13", href: "/calendar", label: "Production Calendar", icon: CalendarDays },
  { n: "14", href: "/analytics", label: "Analytics & Learning", icon: BarChart3 },
  { n: "15", href: "/approvals", label: "Approvals", icon: CheckCircle2 },
  { n: "16", href: "/settings", label: "Settings & Integrations", icon: Settings },
];

export function Sidebar({ approvals, orgName, userName, role }: { approvals: number; orgName: string; userName: string; role: string }) {
  const path = usePathname();
  return (
    <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-r border-white/[0.05] bg-ink-950/70 backdrop-blur lg:flex">
      <Link href="/mission" className="flex items-center gap-3 px-5 pb-5 pt-6">
        <div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-calm-300 to-calm-600 shadow-glow">
          <span className="font-display text-lg font-semibold text-ink-950">C</span>
        </div>
        <div>
          <div className="font-display text-[15px] leading-none tracking-wide text-white">CALMLINGS OS</div>
          <div className="mt-1 text-[11px] text-mist-400">{orgName}</div>
        </div>
      </Link>
      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        {NAV.map((item) => {
          const active = path === item.href || path.startsWith(item.href + "/");
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn("group mb-0.5 flex items-center gap-3 rounded-lg px-2.5 py-[7px] text-[13px] transition", active ? "bg-calm-400/[0.12] text-white" : "text-mist-300 hover:bg-white/[0.04] hover:text-white")}
            >
              <span className={cn("w-5 font-mono text-[10px]", active ? "text-calm-300" : "text-mist-500")}>{item.n}</span>
              <Icon className={cn("size-4", active ? "text-calm-300" : "text-mist-400 group-hover:text-mist-200")} />
              <span className="flex-1 truncate">{item.label}</span>
              {item.href === "/approvals" && approvals > 0 && <span className="rounded-full bg-warn/20 px-1.5 text-[10px] font-semibold text-warn">{approvals}</span>}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-white/[0.05] px-5 py-4 text-xs">
        <div className="text-mist-200">{userName}</div>
        <div className="flex items-center justify-between text-mist-500">
          <span>{role.replace("_", " ")}</span>
          <form action="/api/auth/logout" method="post">
            <button className="hover:text-mist-200">Sign out</button>
          </form>
        </div>
      </div>
    </aside>
  );
}

export function MobileNav() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-white/[0.05] px-3 py-2 lg:hidden">
      {NAV.map((item) => (
        <Link key={item.href} href={item.href} className={cn("whitespace-nowrap rounded-md px-2.5 py-1 text-xs", path.startsWith(item.href) ? "bg-calm-400/15 text-white" : "text-mist-400")}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
