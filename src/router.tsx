import { QueryClient } from '@tanstack/react-query'
import { createRouter, redirect } from '@tanstack/react-router'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'

// Import the generated route tree
import { routeTree } from './routeTree.gen'

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}

// Create a new router instance
export const getRouter = () => {
  const queryClient = new QueryClient()

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: ({ error }) => {
      if (
        error?.message === 'Unauthorized' ||
        error?.message?.includes('Unauthorized')
      ) {
        throw redirect({ to: '/auth/login' })
      }
      return undefined
    },
  })

  setupRouterSsrQueryIntegration({
    router,
    queryClient,
  })

  return router
}
