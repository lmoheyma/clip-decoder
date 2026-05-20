export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden
      className="block drop-shadow-[0_0_12px_color-mix(in_oklab,var(--grad-lavender)_35%,transparent)]"
    >
      <defs>
        <linearGradient id="brand-mark-aurora" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--grad-peach)" />
          <stop offset="50%" stopColor="var(--grad-lavender)" />
          <stop offset="100%" stopColor="var(--grad-rose)" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="6" fill="var(--canvas-soft)" />
      <circle cx="16" cy="16" r="7.5" fill="url(#brand-mark-aurora)" />
    </svg>
  );
}
