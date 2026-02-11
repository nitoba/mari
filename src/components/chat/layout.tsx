import { SidebarInset, SidebarProvider } from '../ui/sidebar'
import { ChatSidebar } from './sidebar'

export type ChatLayoutProps = {
  children: React.ReactNode
}

export function ChatLayout({ children }: ChatLayoutProps) {
  return (
    <SidebarProvider>
      <ChatSidebar />
      <SidebarInset>{children}</SidebarInset>
    </SidebarProvider>
  )
}
