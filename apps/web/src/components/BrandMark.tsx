/** Product mark: a monitor glyph in a gradient tile. Pure SVG, no assets. */
export function BrandMark({ size = 18 }: { size?: number }) {
  return (
    <span className="brand-mark" aria-hidden="true">
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="2" y="3" width="20" height="13" rx="2" />
        <path d="M8 21h8M12 16v5" />
      </svg>
    </span>
  );
}
