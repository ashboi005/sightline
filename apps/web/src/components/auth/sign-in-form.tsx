"use client";

import { Button } from "@sightline/ui/components/button";
import { Input } from "@sightline/ui/components/input";
import { Label } from "@sightline/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { LoaderCircle } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import z from "zod";

import { useSignIn } from "@/hooks/use-auth";

import { authErrorMessage } from "./auth-error";
import { FieldError, FormAlert, PasswordInput } from "./fields";
import { useSignedInDestination } from "./use-signed-in-destination";

const schema = z.object({
  email: z.email("Enter a valid email address, like name@college.edu"),
  password: z.string().min(1, "Enter your password"),
});

export function SignInForm() {
  const router = useRouter();
  const signIn = useSignIn();
  const { destination, carry } = useSignedInDestination();

  const form = useForm({
    defaultValues: { email: "", password: "" },
    // Validate on every change so errors clear as soon as the input is fixed; show them only after blur or submit.
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      await signIn.mutateAsync(value, { onSuccess: () => router.push(destination) }).catch(() => {});
    },
  });

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-[-0.02em] sm:text-4xl">Welcome back</h1>
      <p className="mt-2.5 text-base text-muted-foreground">Sign in to open your lectures and notes.</p>

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
        className="mt-9 space-y-5"
      >
        <FormAlert message={signIn.error ? authErrorMessage(signIn.error) : null} />

        <form.Field name="email">
          {(field) => {
            const showError =
              (field.state.meta.isBlurred || field.form.state.submissionAttempts > 0) &&
              field.state.meta.errors.length > 0;
            return (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Email</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  type="email"
                  autoComplete="email"
                  inputMode="email"
                  autoFocus
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={showError || undefined}
                  aria-describedby={showError ? `${field.name}-error` : undefined}
                />
                {showError && <FieldError id={`${field.name}-error`} errors={field.state.meta.errors} />}
              </div>
            );
          }}
        </form.Field>

        <form.Field name="password">
          {(field) => {
            const showError =
              (field.state.meta.isBlurred || field.form.state.submissionAttempts > 0) &&
              field.state.meta.errors.length > 0;
            return (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Password</Label>
                <PasswordInput
                  id={field.name}
                  name={field.name}
                  autoComplete="current-password"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={showError || undefined}
                  aria-describedby={showError ? `${field.name}-error` : undefined}
                />
                {showError && <FieldError id={`${field.name}-error`} errors={field.state.meta.errors} />}
              </div>
            );
          }}
        </form.Field>

        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
              {isSubmitting && <LoaderCircle className="animate-spin" />}
              {isSubmitting ? "Signing in" : "Sign in"}
            </Button>
          )}
        </form.Subscribe>
      </form>

      <p className="mt-8 text-base text-muted-foreground">
        New to Sightline?{" "}
        <Link
          href={`/sign-up${carry}` as Route}
          className="font-semibold text-foreground underline decoration-marigold decoration-2 underline-offset-4 hover:decoration-foreground"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
