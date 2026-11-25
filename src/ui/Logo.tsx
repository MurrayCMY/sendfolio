/** The SendFolio mark: a folded page. Uses currentColor, so it follows the surrounding text colour. */
export function Logo({ size = 20 }: { size?: number }) {
  return (
    <svg class="logo" width={size} height={size} viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      <path d="M9 4h10l6 6v16a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
      <path d="M19 4v6h6" />
      <path d="M11.5 17h9M11.5 21.5h6" />
    </svg>
  );
}
