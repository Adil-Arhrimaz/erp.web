import { AppHeader } from "@/components/app-shell/app-header";
import { AppSidebar } from "@/components/app-shell/app-sidebar";
import { MobileNav } from "@/components/app-shell/mobile-nav";
import { PinDialog } from "@/components/app-shell/pin-dialog";
import { ServiceWorker } from "@/components/service-worker";
import { SessionProvider } from "@/components/session-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { requireSession } from "@/server/session";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const { context } = await requireSession();

  return (
    <SessionProvider value={context}>
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <AppHeader />
          <main className="flex-1 px-4 pt-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:px-6 md:pb-8">
            {children}
          </main>
        </SidebarInset>
        <MobileNav />
      </SidebarProvider>
      <ServiceWorker />
      <PinDialog />
    </SessionProvider>
  );
}
