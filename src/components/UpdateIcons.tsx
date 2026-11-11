/* Small line icons for the update buttons, drawn in the current text colour. */

type IconProps = { size?: number };

const svg = (size: number, path: string) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={path} />
  </svg>
);

export const DownloadIcon = ({ size = 18 }: IconProps) => svg(size, "M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14");
export const CheckIcon = ({ size = 18 }: IconProps) => svg(size, "M5 12.5 10 17.5 19 7");
export const RefreshIcon = ({ size = 16 }: IconProps) => svg(size, "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7");
