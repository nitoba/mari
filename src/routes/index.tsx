import { Link, createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/')({ component: App })

function App() {
  const session = authClient.useSession()

  const handleLogout = async () => {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          toast.success('Sessão encerrada com sucesso')
        },
      },
    })
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <div className="flex flex-col items-center gap-2">
        <h1 className="text-4xl font-bold tracking-tight">Mari</h1>
        <p className="text-muted-foreground">
          O futuro da sua gestão rural começa aqui.
        </p>
      </div>

      <div className="flex flex-col items-center gap-4">
        {session.data ? (
          <div className="flex flex-col items-center gap-4">
            <p className="text-sm">
              Bem-vindo, <strong>{session.data.user.name}</strong> (
              {session.data.user.email})
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                render={<Link to="/chat">Ir para o Chat</Link>}
              />

              <Button variant="ghost" onClick={handleLogout}>
                Sair
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button>
              <Link to="/auth/login">Entrar</Link>
            </Button>
            <Button variant="outline">
              <Link to="/auth/register">Criar conta</Link>
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
