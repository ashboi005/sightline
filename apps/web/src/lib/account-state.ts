// Things this browser remembers for the signed-in student. They belong to that account, so they're cleared
// whenever someone signs in or out (a second student on the same laptop must not inherit them).

export const ACTIVE_LECTURE_KEY = "sightline.active-lecture";

export function clearAccountState() {
  try {
    localStorage.removeItem(ACTIVE_LECTURE_KEY);
  } catch {
    // storage blocked: nothing was remembered
  }
}

/** Where to go after signing in: the same-site path from `?next=`, or the dashboard. */
export function signedInDestination(next: string | null): string {
  const safe = next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/sign-");
  return safe ? next : "/dashboard";
}
