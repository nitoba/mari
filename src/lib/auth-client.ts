import { createAuthClient } from 'better-auth/react'
import {
  customSessionClient,
  inferAdditionalFields,
} from 'better-auth/client/plugins'
import type { auth } from './auth'

export const authClient = createAuthClient({
  plugins: [
    customSessionClient<typeof auth>(),
    inferAdditionalFields<typeof auth>(),
  ],
})
