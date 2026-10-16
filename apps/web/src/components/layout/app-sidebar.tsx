// The sidebar (STYLE.md 6): the navigation tree, the current page marked by its patterns, its records
// included. Collapsed, an item's word is its tooltip; on a phone the same tree is a sheet.

import { Link, useLocation } from "react-router"

import { isCurrent, NAVIGATION } from "../../app/navigation"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "../ui/sidebar"

export function AppSidebar() {
  const { pathname } = useLocation()
  const { isMobile, setOpenMobile } = useSidebar()
  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <nav aria-label="Dashboard">
          {NAVIGATION.map((group) => (
            <SidebarGroup key={group.id}>
              <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map((item) => {
                    const current = isCurrent(item, pathname)
                    return (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton asChild isActive={current} tooltip={item.label}>
                          <Link
                            to={item.to}
                            aria-current={current ? "page" : undefined}
                            onClick={() => isMobile && setOpenMobile(false)}
                          >
                            <item.icon aria-hidden="true" />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </nav>
      </SidebarContent>
    </Sidebar>
  )
}
