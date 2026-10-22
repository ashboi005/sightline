import katex from "katex";

import { cn } from "@sightline/ui/lib/utils";

/** Renders a LaTeX string with KaTeX. `display` gives a centred block, like formula captions in the workspace. */
export function Formula({
  tex,
  display = false,
  className,
}: {
  tex: string;
  display?: boolean;
  className?: string;
}) {
  const html = katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "html" });
  return <span className={cn(className)} dangerouslySetInnerHTML={{ __html: html }} />;
}
