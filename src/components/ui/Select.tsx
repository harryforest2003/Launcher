import { forwardRef, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import "./ui.css";

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & {
  /** sm: 28px tall, for toolbars and the sidebar. md (default): 34px. */
  size?: "sm" | "md";
  /** Class for the wrapper (width, margins). `className` goes on the <select> itself. */
  wrapperClassName?: string;
};

/*
 * The launcher's drop-down list: a native <select> (so the keyboard, screen readers and the
 * system's own list all work as people expect), drawn to match the inputs, with its arrow in
 * the text colour so it follows the theme. Give it a visible <label> or an aria-label.
 */
const Select = forwardRef<HTMLSelectElement, Props>(function Select({ size = "md", wrapperClassName, className, children, ...rest }, ref) {
  return (
    <span className={["ui-select", size === "sm" && "ui-select--sm", wrapperClassName].filter(Boolean).join(" ")}>
      <select ref={ref} className={["ui-select__control", className].filter(Boolean).join(" ")} {...rest}>
        {children}
      </select>
      <ChevronDown className="ui-select__arrow" size={size === "sm" ? 14 : 16} aria-hidden="true" />
    </span>
  );
});

export default Select;
