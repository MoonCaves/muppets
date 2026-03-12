interface MonoLabelProps {
  children: React.ReactNode;
  className?: string;
}

export default function MonoLabel({ children, className = '' }: MonoLabelProps) {
  return (
    <span className={`text-[9px] text-slate-500 dark:text-white/40 tracking-[2px] font-mono ${className}`}>
      {children}
    </span>
  );
}
