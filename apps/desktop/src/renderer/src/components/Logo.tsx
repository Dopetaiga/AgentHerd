// The AgentHerd mark: a fluffy sheep on an inverted tile. Drawn inline, no assets.

export function Logo({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="AgentHerd"
      className="shrink-0"
    >
      <rect width="32" height="32" rx="8" fill="var(--ah-invert)" />
      <g fill="var(--ah-on-invert)">
        <circle cx="13" cy="13.5" r="4.6" />
        <circle cx="18.5" cy="11.8" r="4.8" />
        <circle cx="23" cy="15.2" r="4.2" />
        <circle cx="19.5" cy="18.4" r="4.6" />
        <circle cx="14" cy="18.6" r="4.2" />
      </g>
      <g stroke="var(--ah-on-invert)" strokeWidth="2.2" strokeLinecap="round">
        <path d="M14.2 22v3.6M20.6 22v3.6" />
      </g>
      <ellipse
        cx="9.2"
        cy="15.6"
        rx="3.1"
        ry="3.8"
        fill="var(--ah-invert)"
        stroke="var(--ah-on-invert)"
        strokeWidth="1.6"
      />
      <circle cx="8.4" cy="15" r="0.9" fill="var(--ah-on-invert)" />
    </svg>
  );
}
