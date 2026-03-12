import { useRef, useEffect } from 'react';
import type { Message, ToolCall } from '../../api/types';
import ChatMessage from './ChatMessage';
import ToolCallCard from './ToolCallCard';
import MarkdownRenderer from './MarkdownRenderer';

interface ChatAreaProps {
  messages: Message[];
  isStreaming: boolean;
  streamingText: string;
  streamingStatus: string;
  streamingTools: ToolCall[];
  agentName: string;
}

export default function ChatArea({
  messages,
  isStreaming,
  streamingText,
  streamingStatus,
  streamingTools,
  agentName,
}: ChatAreaProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingText, streamingTools]);

  if (messages.length === 0 && !isStreaming) {
    return (
      <div className="flex-1 overflow-y-auto p-4 chat-scroll flex flex-col items-center justify-center text-center">
        <div
          className="text-[11px] text-violet-600 dark:text-violet-400 tracking-[2px] mb-4 font-mono"
        >
          READY
        </div>
        <h3
          className="text-xl text-slate-800 dark:text-white/90 mb-2"
          style={{ fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 400 }}
        >
          Start a conversation with {agentName}
        </h3>
        <p
          className="text-sm text-slate-500 dark:text-white/50 mb-6 max-w-md"
          style={{ fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 300 }}
        >
          Chat to execute tasks, train your agent, or manage configuration.
          {agentName} evolves through conversation.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 chat-scroll">
      <div className="space-y-4">
        {messages.map((msg) => (
          <ChatMessage
            key={msg.id}
            role={msg.role}
            content={msg.content}
            timestamp={msg.timestamp}
            toolCalls={msg.toolCalls}
          />
        ))}

        {/* Live streaming bubble */}
        {isStreaming && (
          <div className="flex justify-start">
            <div className="max-w-[80%] px-4 py-3 bg-slate-100 dark:bg-white/[0.02] border streaming-pulse">
              {/* Live tool calls */}
              {streamingTools.length > 0 && (
                <div className="space-y-1 mb-3">
                  {streamingTools.map((tool) => (
                    <ToolCallCard key={tool.id} tool={tool} />
                  ))}
                </div>
              )}

              {/* Streaming text */}
              {streamingText ? (
                <MarkdownRenderer content={streamingText} />
              ) : (
                /* Status indicator when no text yet */
                <div className="flex items-center gap-2">
                  <div className="flex gap-0.5">
                    <span className="w-1 h-1 bg-violet-400 rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
                    <span className="w-1 h-1 bg-violet-400 rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
                    <span className="w-1 h-1 bg-violet-400 rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
                  </div>
                  <span
                    className="text-sm text-slate-500 dark:text-white/40"
                    style={{ fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 300 }}
                  >
                    {streamingStatus || `${agentName} is thinking...`}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>
    </div>
  );
}
