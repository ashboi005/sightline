"use client";

import { Button } from "@sightline/ui/components/button";
import { Input } from "@sightline/ui/components/input";
import { Label } from "@sightline/ui/components/label";
import { useForm } from "@tanstack/react-form";
import { LoaderCircle } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import z from "zod";

import { useSignUp } from "@/hooks/use-auth";

import { authErrorMessage } from "./auth-error";
import { FieldError, FieldHint, FormAlert, PasswordInput } from "./fields";
import { useSignedInDestination } from "./use-signed-in-destination";

// better-auth's server defaults: 8–128 characters.
const schema = z.object({
  name: z.string().trim().min(2, "Enter your name, at least 2 characters"),
  email: z.email("Enter a valid email address, like name@college.edu"),
  password: z
    .string()
    .min(8, "Use at least 8 characters")
    .max(128, "Use 128 characters or fewer"),
});

export function SignUpForm() {
  const router = useRouter();
  const signUp = useSignUp();
  const { destination, carry } = useSignedInDestination();

  const form = useForm({
    defaultValues: { name: "", email: "", password: "" },
    // Validate on every change so errors clear as soon as the input is fixed; show them only after blur or submit.
    validators: { onChange: schema },
    onSubmit: async ({ value }) => {
      await signUp
        .mutateAsync(
          { ...value, name: value.name.trim() },
          {
            onSuccess: () => {
              toast.success("Account created");
              router.push(destination);
            },
          },
        )
        .catch(() => {});
    },
  });

  return (
    <div>
      <h1 className="text-3xl font-bold tracking-[-0.02em] sm:text-4xl">Create your account</h1>
      <p className="mt-2.5 text-base text-muted-foreground">
        Your lectures, captions and notes are saved to it.
      </p>

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
        className="mt-9 space-y-5"
      >
        <FormAlert message={signUp.error ? authErrorMessage(signUp.error) : null} />

        <form.Field name="name">
          {(field) => {
            const showError =
              (field.state.meta.isBlurred || field.form.state.submissionAttempts > 0) &&
              field.state.meta.errors.length > 0;
            return (
              <div className="space-y-2">
                <Label htmlFor={field.name}>Name</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  autoComplete="name"
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
                  autoComplete="new-password"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  aria-invalid={showError || undefined}
                  aria-describedby={`${field.name}-${showError ? "error" : "hint"}`}
                />
                {showError ? (
                  <FieldError id={`${field.name}-error`} errors={field.state.meta.errors} />
                ) : (
                  <FieldHint id={`${field.name}-hint`}>At least 8 characters.</FieldHint>
                )}
              </div>
            );
          }}
        </form.Field>

        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
              {isSubmitting && <LoaderCircle className="animate-spin" />}
              {isSubmitting ? "Creating account" : "Create account"}
            </Button>
          )}
        </form.Subscribe>
      </form>

      <p className="mt-8 text-base text-muted-foreground">
        Already have an account?{" "}
        <Link
          href={`/sign-in${carry}` as Route}
          className="font-semibold text-foreground underline decoration-marigold decoration-2 underline-offset-4 hover:decoration-foreground"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
