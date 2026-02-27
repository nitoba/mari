import { Link, createFileRoute } from '@tanstack/react-router'
import { useForm } from '@tanstack/react-form'
import { zodValidator } from '@tanstack/zod-form-adapter'
import { z } from 'zod'
import { toast } from 'sonner'
import { useState } from 'react'
import { ArrowLeft, Loader2 } from 'lucide-react'
import { authClient } from '@/lib/auth-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'

export const Route = createFileRoute('/auth/forgot-password')({
  component: ForgotPasswordPage,
})

const forgotPasswordSchema = z.object({
  email: z.string().email('E-mail inválido'),
})

function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const form = useForm({
    defaultValues: {
      email: '',
    },
    validators: {
      onChange: forgotPasswordSchema,
    },
    onSubmit: async ({ value }) => {
      setLoading(true)
      const { error } = await authClient.requestPasswordReset({
        email: value.email,
        redirectTo: '/auth/reset-password',
      })

      if (error) {
        toast.error(error.message || 'Erro ao processar solicitação')
        setLoading(false)
        return
      }

      toast.success('E-mail de recuperação enviado!')
      setSubmitted(true)
      setLoading(false)
    },
  })

  if (submitted) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Verifique seu e-mail</CardTitle>
          <CardDescription>
            Enviamos um link de recuperação para o e-mail informado.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 py-6">
          <div className="bg-primary/10 flex h-12 w-12 items-center justify-center rounded-full">
            <ArrowLeft className="text-primary h-6 w-6" />
          </div>
          <p className="text-center text-sm text-muted-foreground">
            Se você não receber o e-mail em alguns minutos, verifique sua pasta
            de spam.
          </p>
        </CardContent>
        <CardFooter className="border-t py-4">
          <Button
            variant="outline"
            className="w-full"
            render={<Link to="/auth/login">Voltar para o login</Link>}
          />
        </CardFooter>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recuperar senha</CardTitle>
        <CardDescription>
          Digite seu e-mail para receber um link de recuperação.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            e.stopPropagation()
            form.handleSubmit()
          }}
          className="space-y-4"
        >
          <FieldGroup>
            <form.Field
              name="email"
              children={(field) => {
                const isInvalid =
                  field.state.meta.isTouched && !field.state.meta.isValid
                return (
                  <Field data-invalid={isInvalid}>
                    <FieldLabel htmlFor={field.name}>E-mail</FieldLabel>
                    <Input
                      id={field.name}
                      name={field.name}
                      type="email"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      aria-invalid={isInvalid}
                      placeholder="seu@email.com"
                      autoComplete="email"
                    />
                    {isInvalid && (
                      <FieldError errors={field.state.meta.errors} />
                    )}
                  </Field>
                )
              }}
            />
          </FieldGroup>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Enviar link
          </Button>
        </form>
      </CardContent>
      <CardFooter className="flex flex-col gap-2 border-t py-4">
        <div className="text-muted-foreground text-center text-xs">
          Lembrou sua senha?{' '}
          <Link to="/auth/login" className="text-primary hover:underline">
            Voltar para o login
          </Link>
        </div>
      </CardFooter>
    </Card>
  )
}
