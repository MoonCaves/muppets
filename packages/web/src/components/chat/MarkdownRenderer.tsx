import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  content: string;
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div
      className="text-sm text-slate-800 dark:text-white/90 leading-relaxed max-w-none min-w-0 break-words [overflow-wrap:anywhere]"
      style={{ fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 300 }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold text-slate-900 dark:text-white">{children}</strong>,
          em: ({ children }) => <em className="text-slate-700 dark:text-white/80">{children}</em>,
          ul: ({ children }) => <ul className="my-2 ml-4 list-disc">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 ml-4 list-decimal">{children}</ol>,
          li: ({ children }) => <li className="my-0.5">{children}</li>,
          a: ({ href, children }) => (
            <a href={href} className="text-cyan-600 dark:text-cyan-400 hover:underline break-all" target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          h1: ({ children }) => <h1 className="text-lg font-semibold text-slate-900 dark:text-white mt-4 mb-2">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-semibold text-slate-900 dark:text-white mt-3 mb-2">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold text-slate-900 dark:text-white mt-2 mb-1">{children}</h3>,
          code: ({ children }) => (
            <code className="bg-slate-200 dark:bg-white/10 px-1.5 py-0.5 rounded text-cyan-700 dark:text-cyan-300 text-xs font-mono break-all">{children}</code>
          ),
          pre: ({ children }) => (
            <pre className="bg-slate-200 dark:bg-black/30 border border-slate-300 dark:border-white/10 p-3 rounded my-2 overflow-x-auto">{children}</pre>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
