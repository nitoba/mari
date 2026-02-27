import * as React from "react"
import { Eye, EyeOff } from "lucide-react"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "./input-group"
import { cn } from "@/lib/utils"

interface PasswordInputProps extends React.ComponentProps<"input"> {
  className?: string
}

function PasswordInput({ className, ...props }: PasswordInputProps) {
  const [showPassword, setShowPassword] = React.useState(false)

  const togglePassword = () => setShowPassword((prev) => !prev)

  return (
    <InputGroup className={cn("relative", className)}>
      <InputGroupInput
        {...props}
        type={showPassword ? "text" : "password"}
        className="pr-10"
      />
      <InputGroupAddon align="inline-end" className="absolute right-0 top-0 h-full">
        <InputGroupButton
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={togglePassword}
          aria-label={showPassword ? "Esconder senha" : "Mostrar senha"}
          tabIndex={-1}
        >
          {showPassword ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}

export { PasswordInput }
