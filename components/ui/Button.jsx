import Link from "next/link";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

const variants = { primary: "btn-primary", secondary: "btn-secondary", ghost: "btn-ghost", danger: "btn-danger", success: "btn-success" };
const sizes = { sm: "btn-sm", md: "", lg: "btn-lg" };

export function Button({ variant = "secondary", size = "md", icon: Icon, loading, className, children, href, iconOnly, ...props }) {
  const cls = cn("btn", variants[variant], sizes[size], iconOnly && "btn-icon", className);
  const content = (
    <>
      {loading ? <Loader2 size={15} className="animate-spin" aria-hidden /> : Icon ? <Icon size={15} aria-hidden /> : null}
      {children}
    </>
  );
  if (href) return <Link href={href} className={cls} {...props}>{content}</Link>;
  return (
    <button type="button" className={cls} disabled={loading || props.disabled} aria-busy={loading || undefined} {...props}>
      {content}
    </button>
  );
}
