import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'
import { authClient } from '@/lib/auth-client'

export const Route = createFileRoute('/auth')({
  beforeLoad: async () => {
    // This runs on the server and client
    // For TanStack Start, we can use the session on the server too if configured
    const session = await authClient.getSession()
    if (session.data) {
      throw redirect({
        to: '/',
      })
    }
  },
  component: AuthLayout,
})

function AuthLayout() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-6 dark:bg-slate-950">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Mari</h1>
          <p className="text-muted-foreground text-sm">
            Welcome back to the future.
          </p>
        </div>
        <Outlet />
      </div>
    </div>
  )
}
