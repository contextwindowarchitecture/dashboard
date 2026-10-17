// One shell for every page (STYLE.md 5, 6): the skip link first, the sidebar, then the masthead, the
// one main and the footer side by side in the inset. The sidebar starts collapsed to icons up to
// 1200px and becomes a sheet below the generated sidebar's 768px; a desktop choice is kept.

import { Outlet } from "react-router"

import { SidebarProvider } from "../ui/sidebar"
import { AppSidebar } from "./app-sidebar"
import { Footer } from "./footer"
import { Masthead } from "./masthead"
import { RouteEffects } from "./route-effects"
import { TenantScope } from "./tenant-scope"

const COOKIE = "sidebar_state"

function initiallyOpen(): boolean {
  const stored = document.cookie.split("; ").find((part) => part.startsWith(`${COOKIE}=`))
  if (stored) return stored.endsWith("=true")
  return typeof window.matchMedia === "function"
    ? !window.matchMedia("(max-width: 1200px)").matches
    : true
}

export function Shell() {
  return (
    <TenantScope>
      <SidebarProvider defaultOpen={initiallyOpen()}>
        <a href="#main" data-slot="skip-link">
          Skip to content
        </a>
        <AppSidebar />
        <div data-slot="inset" className="relative flex min-w-0 flex-1 flex-col bg-background">
          <Masthead />
          <main id="main" tabIndex={-1} className="flex-1">
            <Outlet />
          </main>
          <Footer />
        </div>
        <RouteEffects />
      </SidebarProvider>
    </TenantScope>
  )
}
