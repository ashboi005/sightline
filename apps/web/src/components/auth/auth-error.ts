/** Turns a failed auth call into a sentence that says what happened and what to do. */
export function authErrorMessage(error: Error): string {
  const message = error.message || "";
  if (/fetch|network/i.test(message)) {
    return "Can't reach the Sightline server. Check your connection and try again.";
  }
  if (/internal server error|bad gateway|service unavailable/i.test(message)) {
    return "The Sightline server ran into a problem. Try again in a minute.";
  }
  if (/invalid email or password/i.test(message)) {
    return "That email and password don't match an account. Check them and try again.";
  }
  if (/already exists/i.test(message)) {
    return "An account with this email already exists. Sign in instead.";
  }
  return message || "Something went wrong. Try again.";
}
