export function SavedEvidenceMark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="M6 3h8l4 4v13H6zM14 3v4h4M9 10h6M9 13h3" />
      <circle cx="14" cy="16.5" r="1.5" />
    </svg>
  );
}
