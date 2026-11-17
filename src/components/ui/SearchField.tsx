import type { InputHTMLAttributes } from "react";
import { Search } from "lucide-react";
import "./ui.css";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
  wrapperClassName?: string;
};

export default function SearchField({ label, wrapperClassName, className, ...props }: Props) {
  return (
    <label className={["ui-search", wrapperClassName].filter(Boolean).join(" ")}>
      <Search size={16} aria-hidden="true" />
      <span className="u-visually-hidden">{label}</span>
      <input {...props} type="search" className={["ui-input", className].filter(Boolean).join(" ")} />
    </label>
  );
}
