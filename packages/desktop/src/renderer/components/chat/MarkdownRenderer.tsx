/**
 * Markdown renderer for chat messages.
 * Ported from web MarkdownRenderer.tsx.
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  content: string;
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="mb-2 last:mb-0" style={{ lineHeight: '1.6' }}>{children}</p>,
        h1: ({ children }) => <h1 className="text-[16px] font-bold mb-2 mt-4" style={{ fontFamily: 'var(--font-sans)', color: 'var(--fg-primary)' }}>{children}</h1>,
        h2: ({ children }) => <h2 className="text-[14px] font-bold mb-2 mt-3" style={{ fontFamily: 'var(--font-sans)', color: 'var(--fg-primary)' }}>{children}</h2>,
        h3: ({ children }) => <h3 className="text-[13px] font-bold mb-1 mt-2" style={{ fontFamily: 'var(--font-sans)', color: 'var(--fg-primary)' }}>{children}</h3>,
        a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: 'var(--accent-cyan)' }}>{children}</a>,
        code: ({ className, children, ...props }) => {
          const isInline = !className;
          if (isInline) {
            return <code className="px-1 py-0.5 text-[11px]" style={{ fontFamily: 'var(--font-mono)', background: 'var(--bg-tertiary)', color: 'var(--accent-cyan)' }}>{children}</code>;
          }
          return (
            <pre className="p-3 my-2 overflow-x-auto text-[11px]" style={{ background: 'var(--bg-tertiary)', border: '1px solid var(--border-color)' }}>
              <code style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg-primary)' }} {...props}>{children}</code>
            </pre>
          );
        },
        ul: ({ children }) => <ul className="list-disc pl-5 mb-2 space-y-1">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal pl-5 mb-2 space-y-1">{children}</ol>,
        li: ({ children }) => <li style={{ color: 'var(--fg-secondary)' }}>{children}</li>,
        blockquote: ({ children }) => <blockquote className="pl-3 my-2" style={{ borderLeft: '2px solid var(--accent-violet)', color: 'var(--fg-tertiary)' }}>{children}</blockquote>,
        table: ({ children }) => <table className="w-full my-2 text-[11px]" style={{ borderCollapse: 'collapse' }}>{children}</table>,
        th: ({ children }) => <th className="text-left p-1.5 border-b" style={{ borderColor: 'var(--border-color)', color: 'var(--fg-secondary)', fontFamily: 'var(--font-mono)' }}>{children}</th>,
        td: ({ children }) => <td className="p-1.5 border-b" style={{ borderColor: 'var(--border-color)', color: 'var(--fg-primary)' }}>{children}</td>,
        hr: () => <hr className="my-3" style={{ border: 'none', borderTop: '1px solid var(--border-color)' }} />,
        strong: ({ children }) => <strong style={{ fontWeight: 600, color: 'var(--fg-primary)' }}>{children}</strong>,
        em: ({ children }) => <em style={{ color: 'var(--fg-secondary)' }}>{children}</em>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
