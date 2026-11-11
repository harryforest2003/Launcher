/* Small line icons for buttons, drawn in the current text colour. */

type IconProps = { size?: number };

const svg = (size: number, path: string) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={path} />
  </svg>
);

export const DownloadIcon = ({ size = 18 }: IconProps) => svg(size, "M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 20h14");
export const CheckIcon = ({ size = 18 }: IconProps) => svg(size, "M5 12.5 10 17.5 19 7");
export const RefreshIcon = ({ size = 16 }: IconProps) => svg(size, "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7");
export const BinIcon = ({ size = 16 }: IconProps) => svg(size, "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3");
export const SearchIcon = ({ size = 16 }: IconProps) => svg(size, "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4");
export const FilterIcon = ({ size = 16 }: IconProps) => svg(size, "M4 6h16M7 12h10M10 18h4");
export const PlusIcon = ({ size = 16 }: IconProps) => svg(size, "M12 5v14M5 12h14");
export const SaveIcon = ({ size = 18 }: IconProps) => svg(size, "M5 4h11l3 3v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1zM8 4v5h7V4M8 20v-6h8v6");
export const ResetIcon = ({ size = 18 }: IconProps) => svg(size, "M4 11a8 8 0 1 1 2.3 5.7M4 4v7h7");

/* A star, filled in when it's on. */
export const StarIcon = ({ size = 18, filled = false }: IconProps & { filled?: boolean }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />
  </svg>
);
