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

function ToolBubble({ entry }) {
  const [open, setOpen] = useState(false);
  const status = entry.done ? (entry.isError ? '✗' : '✓') : '…';
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
          {entry.args && (
            <pre className="chat-tool-block">{(() => {
              try { return JSON.stringify(entry.args, null, 2); } catch { return String(entry.args); }
            })()}</pre>
          )}
          {entry.output ? <pre className="chat-tool-block">{entry.output}</pre> : null}
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
  const currentAssistantIdRef = useRef(null);
  const idCounterRef = useRef(0);
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);

  const nextId = () => `m${++idCounterRef.current}`;

  // Subscribe to agent events from main.
  useEffect(() => {
    const offEvent = window.api.agent.onEvent((evt) => {
      handleAgentEvent(evt);
    });
    const offError = window.api.agent.onError(({ message }) => {
      setRunning(false);
      setError(message);
    });
    return () => { offEvent?.(); offError?.(); };
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
      return;
    }
    if (evt.type === 'agent_end') {
      setRunning(false);
      currentAssistantIdRef.current = null;
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
          // Stream started without a text_start (shouldn't normally happen) — create lazily.
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

  const onKeyDown = useCallback((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  }, [onSend]);

  return (
    <div className="chat-sidebar" role="region" aria-label="Coding agent chat">
      <header className="chat-sidebar-header">
        <span className="chat-sidebar-title">Coding Agent</span>
        <button
          type="button"
          className="chat-sidebar-close"
          onClick={onClose}
          title="Close chat"
          aria-label="Close chat"
        >×</button>
      </header>

      <div ref={scrollRef} className="chat-messages">
        {messages.length === 0 && !running && (
          <div className="chat-empty">
            {workspacePath
              ? 'Ask the agent to read, edit, or run something in your workspace.'
              : 'Open a workspace to start chatting with the agent.'}
          </div>
        )}
        {messages.map((m) => {
          if (m.kind === 'user') {
            return <div key={m.id} className="chat-message chat-user"><div className="chat-bubble">{m.text}</div></div>;
          }
          if (m.kind === 'assistant') {
            return <div key={m.id} className="chat-message chat-assistant"><div className="chat-bubble">{m.text}</div></div>;
          }
          if (m.kind === 'tool') {
            return <div key={m.id} className="chat-message chat-tool-row"><ToolBubble entry={m} /></div>;
          }
          return null;
        })}
        {running && <div className="chat-thinking">Working…</div>}
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
