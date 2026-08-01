import Link from "next/link";

/**
 * The button vocabulary.
 *
 * Before this existed, `style={{ backgroundColor: "var(--color-hazard)" }}` was hand-written at
 * roughly a dozen call sites — which is *why* `/demo` ended up with four competing yellow blocks
 * in one viewport. With no way to say "secondary", everything defaulted to primary.
 *
 * **Ration `primary`.** One per section, at most. Hazard yellow is documented as a caution colour
 * and only survives doing double duty as the CTA fill while it stays rare; the moment three of
 * them share a screen it stops meaning "do this" and the palette's semantics go with it.
 */

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "md" | "sm";

const BASE =
  "legend inline-flex items-center justify-center gap-2 transition-opacity disabled:cursor-not-allowed disabled:opacity-45";

const SIZES: Record<ButtonSize, string> = {
  md: "px-5 py-3",
  sm: "px-3.5 py-2",
};

/** Variants that need a token colour carry it in `style`; Tailwind cannot see arbitrary vars. */
const VARIANTS: Record<ButtonVariant, { className: string; style?: React.CSSProperties }> = {
  primary: {
    className: "text-ink hover:opacity-90",
    style: { backgroundColor: "var(--color-hazard)" },
  },
  secondary: {
    className: "m-panel text-placard transition-colors hover:bg-enamel-lo",
  },
  danger: {
    className: "text-placard hover:opacity-85",
    style: { boxShadow: "inset 0 0 0 2px var(--color-estop)" },
  },
  ghost: {
    className: "text-placard/60 transition-colors hover:text-placard",
  },
};

type Common = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: React.ReactNode;
};

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  children,
  ...rest
}: Common & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const style = VARIANTS[variant];

  return (
    <button
      type="button"
      {...rest}
      className={`${BASE} ${SIZES[size]} ${style.className} ${className}`}
      style={{ ...style.style, ...rest.style }}
    >
      {children}
    </button>
  );
}

/** Same vocabulary for navigation, so a link CTA never drifts from a button one. */
export function ButtonLink({
  variant = "secondary",
  size = "md",
  className = "",
  children,
  href,
  ...rest
}: Common & { href: string } & Omit<React.ComponentProps<typeof Link>, "href" | "className">) {
  const style = VARIANTS[variant];

  return (
    <Link
      href={href}
      {...rest}
      className={`${BASE} ${SIZES[size]} ${style.className} ${className}`}
      style={style.style}
    >
      {children}
    </Link>
  );
}
