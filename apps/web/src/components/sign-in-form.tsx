import { Button } from "@DreamDev/ui/components/button";
import { Input } from "@DreamDev/ui/components/input";
import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import z from "zod";

import { Field } from "./field";
import { authClient } from "@/lib/auth-client";
import { firstError } from "@/lib/form-errors";

export default function SignInForm({ onSwitchToSignUp }: { onSwitchToSignUp: () => void }) {
  const navigate = useNavigate();
  const { isPending } = authClient.useSession();
  const [showPassword, setShowPassword] = useState(false);

  const form = useForm({
    defaultValues: {
      email: "",
      password: "",
    },
    onSubmit: async ({ value }) => {
      await authClient.signIn.email(
        {
          email: value.email,
          password: value.password,
        },
        {
          onSuccess: () => {
            navigate({ to: "/dashboard", search: {} });
            toast.success("Welcome back");
          },
          onError: (error) => {
            toast.error(error.error.message || error.error.statusText);
          },
        },
      );
    },
    validators: {
      onSubmit: z.object({
        email: z.email("Invalid email address"),
        password: z.string().min(8, "Password must be at least 8 characters"),
      }),
    },
  });

  return (
    <div className="space-y-7">
      <div>
        <p className="text-micro text-primary">Welcome back</p>
        <h1 className="mt-2 font-display text-3xl leading-tight">Sign in to the fund</h1>
        <p className="mt-2 text-sm text-muted-foreground">Use the account your Admin created for you.</p>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          form.handleSubmit();
        }}
        className="space-y-4"
        noValidate
      >
        <form.Field name="email">
          {(field) => (
            <Field label="Email" htmlFor={field.name} error={firstError(field.state.meta.errors)} required>
              <Input
                id={field.name}
                name={field.name}
                type="email"
                autoComplete="email"
                placeholder="you@team.fund"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
              />
            </Field>
          )}
        </form.Field>

        <form.Field name="password">
          {(field) => (
            <Field label="Password" htmlFor={field.name} error={firstError(field.state.meta.errors)} required>
              <div className="relative">
                <Input
                  id={field.name}
                  name={field.name}
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {showPassword ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                </button>
              </div>
            </Field>
          )}
        </form.Field>

        <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
          {({ canSubmit, isSubmitting }) => (
            <Button type="submit" size="lg" className="w-full" disabled={!canSubmit || isSubmitting || isPending}>
              {isSubmitting ? "Signing in…" : "Sign in"}
            </Button>
          )}
        </form.Subscribe>
      </form>

      <p className="text-sm text-muted-foreground">
        New here?{" "}
        <button type="button" onClick={onSwitchToSignUp} className="font-medium text-primary underline-offset-4 hover:underline">
          Create an account
        </button>
      </p>
    </div>
  );
}
