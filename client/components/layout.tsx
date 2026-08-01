/**
 * Layout primitives.
 *
 * "Use the full width" cannot mean stretching prose to 1900px — a line the eye has to track that
 * far is genuinely harder to read. So the width is spent on structure while the measure stays
 * fixed: sections span the frame, paragraphs never exceed `.measure`.
 *
 * Every route imports these rather than inventing its own container, which is how six different
 * `max-w-5xl` values ended up on one page the first time.
 */

const GUTTERS = "px-6 sm:px-10 xl:px-16";

/** Default container. Wide enough to use a large display, bounded enough to stay composed. */
export function Shell({
  children,
  className = "",
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "section" | "header" | "footer" | "main";
}) {
  return <Tag className={`mx-auto w-full max-w-384 ${GUTTERS} ${className}`}>{children}</Tag>;
}

/**
 * Edge to edge. Reserved for media, marquee rails and pinned stages — the things that gain
 * something from touching the viewport edge. Not a default.
 */
export function Bleed({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`w-full ${className}`}>{children}</div>;
}

/**
 * A page section: consistent vertical rhythm and an engraved top edge, so every route breathes
 * at the same cadence.
 */
export function Section({
  children,
  className = "",
  bordered = true,
  id,
}: {
  children: React.ReactNode;
  className?: string;
  bordered?: boolean;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={`${bordered ? "border-t border-black/40" : ""} py-20 lg:py-28 ${className}`}
    >
      {children}
    </section>
  );
}
