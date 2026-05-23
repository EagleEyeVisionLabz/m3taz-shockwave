import React, { useCallback, useEffect, useRef, useState } from 'react';

// Build a short, human-readable summary line for a tool call.
function toolSummary(toolName, args) {
  const a = args ?? {};
  switch (toolName) {
    case 'read':
    case 'write':
    case 'edit':
      return a.file_path ?? a.path ?? '';
    case 'bash':
      return typeof a.command === 'string' ? a.command.split('\n')[0].slice(0, 120) : '';
    case 'grep':
      return a.pattern ?? '';
    case 'find':
      return a.pattern ?? a.path ?? '';
    case 'ls':
      return a.path ?? '';
    default:
      try { return JSON.stringify(a).slice(0, 120); } catch { return ''; }
  }
}

function formatToolResult(result) {
  if (result == null) return '';
  if (typeof result === 'string') return result;
  if (typeof result === 'object') {
    if (typeof result.output === 'string') return result.output;
    if (typeof result.text === 'string') return result.text;
    try { return JSON.stringify(result, null, 2); } catch { return String(result); }
  }
  return String(result);
}

// Xs under 60s, Ym Xs over.
function formatElapsed(ms) {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s}s`;
}

function formatTokens(n) {
  if (!n) return '0';
  if (n < 1000) return String(n);
  const k = n / 1000;
  return k < 10 ? `${k.toFixed(1).replace(/\.0$/, '')}k` : `${Math.round(k)}k`;
}

function ToolEntry({ entry }) {
  const [open, setOpen] = useState(false);
  const status = entry.done ? (entry.isError ? '✗' : '✓') : '…';
  let argsBlock = '';
  if (entry.args) {
    try { argsBlock = JSON.stringify(entry.args, null, 2); } catch { argsBlock = String(entry.args); }
  }
  return (
    <div className={`chat-tool ${entry.isError ? 'chat-tool-error' : ''}`}>
      <button type="button" className="chat-tool-summary" onClick={() => setOpen((v) => !v)}>
        <span className="chat-tool-caret">{open ? '▾' : '▸'}</span>
        <span className="chat-tool-status">{status}</span>
        <span className="chat-tool-name">{entry.toolName}</span>
        <span className="chat-tool-arg">{toolSummary(entry.toolName, entry.args)}</span>
      </button>
      {open && (
        <div className="chat-tool-detail">
          {argsBlock ? <div className="chat-tool-text">{argsBlock}</div> : null}
          {entry.output ? <div className="chat-tool-text">{entry.output}</div> : null}
        </div>
      )}
    </div>
  );
}

export default function ChatSidebar({ onClose, workspacePath }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [tokens, setTokens] = useState(0);
  const currentAssistantIdRef = useRef(null);
  const idCounterRef = useRef(0);
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);
  const runStartRef = useRef(0);
  const tickerRef = useRef(null);

  const nextId = () => `m${++idCounterRef.current}`;

  // Subscribe to agent events from main.
  useEffect(() => {
    const offEvent = window.api.agent.onEvent((evt) => {
      handleAgentEvent(evt);
    });
    const offError = window.api.agent.onError(({ message }) => {
      setRunning(false);
      setError(message);
      if (tickerRef.current) { clearInterval(tickerRef.current); tickerRef.current = null; }
    });
    return () => {
      offEvent?.();
      offError?.();
      if (tickerRef.current) { clearInterval(tickerRef.current); tickerRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll to bottom when new messages arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, running]);

  const handleAgentEvent = useCallback((evt) => {
    if (!evt || !evt.type) return;
    if (evt.type === 'agent_start') {
      setRunning(true);
      setError(null);
      setTokens(0);
      setElapsedMs(0);
      runStartRef.current = Date.now();
      if (tickerRef.current) clearInterval(tickerRef.current);
      tickerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - runStartRef.current);
      }, 200);
      return;
    }
    if (evt.type === 'agent_end') {
      setRunning(false);
      currentAssistantIdRef.current = null;
      if (runStartRef.current) setElapsedMs(Date.now() - runStartRef.current);
      if (tickerRef.current) { clearInterval(tickerRef.current); tickerRef.current = null; }
      return;
    }
    if (evt.type === 'turn_end') {
      // Pi's normalized Usage: { input, output, cacheRead, cacheWrite, totalTokens, cost }.
      // Sum totalTokens across turns — each turn re-pays for the context, so this
      // matches actual billed usage for the run.
      const total = evt.message?.usage?.totalTokens;
      if (typeof total === 'number') setTokens((prev) => prev + total);
      return;
    }
    if (evt.type === 'message_update') {
      const inner = evt.assistantMessageEvent;
      if (!inner) return;
      if (inner.type === 'text_start') {
        const id = nextId();
        currentAssistantIdRef.current = id;
        setMessages((prev) => [...prev, { id, kind: 'assistant', text: '' }]);
        return;
      }
      if (inner.type === 'text_delta') {
        const id = currentAssistantIdRef.current;
        if (!id) {
          const newId = nextId();
          currentAssistantIdRef.current = newId;
          setMessages((prev) => [...prev, { id: newId, kind: 'assistant', text: inner.delta ?? '' }]);
          return;
        }
        setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, text: m.text + (inner.delta ?? '') } : m)));
        return;
      }
      return;
    }
    if (evt.type === 'tool_execution_start') {
      currentAssistantIdRef.current = null;
      const id = nextId();
      setMessages((prev) => [...prev, {
        id,
        kind: 'tool',
        toolCallId: evt.toolCallId,
        toolName: evt.toolName,
        args: evt.args,
        output: '',
        isError: false,
        done: false,
      }]);
      return;
    }
    if (evt.type === 'tool_execution_update') {
      setMessages((prev) => prev.map((m) => (
        m.kind === 'tool' && m.toolCallId === evt.toolCallId
          ? { ...m, output: formatToolResult(evt.partialResult) }
          : m
      )));
      return;
    }
    if (evt.type === 'tool_execution_end') {
      setMessages((prev) => prev.map((m) => (
        m.kind === 'tool' && m.toolCallId === evt.toolCallId
          ? { ...m, output: formatToolResult(evt.result), isError: !!evt.isError, done: true }
          : m
      )));
      return;
    }
  }, []);

  const onSend = useCallback(async () => {
    const text = input.trim();
    if (!text || running) return;
    if (!workspacePath) {
      setError('Open a workspace first.');
      return;
    }
    setError(null);
    const userId = nextId();
    setMessages((prev) => [...prev, { id: userId, kind: 'user', text }]);
    setInput('');
    setRunning(true);
    try {
      await window.api.agent.send(text);
    } catch (err) {
      setRunning(false);
      setError(err?.message ?? String(err));
    }
  }, [input, running, workspacePath]);

  const onStop = useCallback(async () => {
    try { await window.api.agent.abort(); } catch {}
  }, []);

  const onClear = useCallback(async () => {
    try { await window.api.agent.reset(); } catch {}
    if (tickerRef.current) { clearInterval(tickerRef.current); tickerRef.current = null; }
    currentAssistantIdRef.current = null;
    setMessages([]);
    setError(null);
    setRunning(false);
    setTokens(0);
    setElapsedMs(0);
  }, []);

  const onKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }, [onSend]);

  return (
    <div className="chat-sidebar" role="region" aria-label="Coding agent chat">
      <div className="chat-sidebar-header">
        <span className="chat-sidebar-title">
          <svg
            className="chat-sidebar-icon"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            width={16}
            height={16}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 8V4H8" />
            <rect width={16} height={12} x={4} y={8} rx={2} />
            <path d="M2 14h2" />
            <path d="M20 14h2" />
            <path d="M15 13v2" />
            <path d="M9 13v2" />
          </svg>
          <span className="chat-sidebar-title-text">Agent Chat</span>
        </span>
        <button
          type="button"
          className="chat-sidebar-clear"
          onClick={onClear}
          title="Clear chat and start a new session (picks up new skills)"
          aria-label="Clear chat"
        >Clear</button>
        <button
          type="button"
          className="chat-sidebar-close"
          onClick={onClose}
          title="Close coding agent"
          aria-label="Close coding agent"
        >×</button>
      </div>

      <div ref={scrollRef} className="chat-messages">
        {messages.map((m) => {
          if (m.kind === 'user') {
            return <div key={m.id} className="chat-message chat-user"><div className="chat-bubble">{m.text}</div></div>;
          }
          if (m.kind === 'assistant') {
            return <div key={m.id} className="chat-message chat-assistant"><div className="chat-bubble">{m.text}</div></div>;
          }
          if (m.kind === 'tool') {
            return <div key={m.id} className="chat-message chat-tool-row"><ToolEntry entry={m} /></div>;
          }
          return null;
        })}
        {running && (
          <div className="chat-thinking">
            <svg
              className="chat-spinner"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              width={12}
              height={12}
              aria-hidden="true"
            >
              <path d="M21 12a9 9 0 1 1-6.219-8.56" />
            </svg>
            <span className="thinking-shimmer">Working</span>
            <span className="chat-thinking-stats">
              {formatElapsed(elapsedMs)}
              {tokens > 0 && ` · ${formatTokens(tokens)} tokens`}
            </span>
          </div>
        )}
        {error && <div className="chat-error">{error}</div>}
      </div>

      <div className="chat-composer">
        <textarea
          ref={textareaRef}
          className="chat-input"
          value={input}
          placeholder={running ? 'Agent is working…' : 'Ask the agent…'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          disabled={running}
        />
        <div className="chat-composer-actions">
          {running ? (
            <button type="button" className="chat-stop-btn" onClick={onStop}>Stop</button>
          ) : (
            <button
              type="button"
              className="chat-send-btn"
              onClick={onSend}
              disabled={!input.trim() || !workspacePath}
            >Send</button>
          )}
        </div>
      </div>
    </div>
  );
}
