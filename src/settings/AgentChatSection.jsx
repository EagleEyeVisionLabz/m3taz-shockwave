import React, { useEffect, useState } from 'react';
import { AI_PROVIDERS } from '../constants.js';

const PROVIDER_OPTIONS = [
  { value: AI_PROVIDERS.ANTHROPIC, label: 'Anthropic' },
  { value: AI_PROVIDERS.OPENAI, label: 'OpenAI' },
];

function ProviderModelKey({ idPrefix, provider, model, apiKey, onChange, modelPlaceholder }) {
  const [showKey, setShowKey] = useState(false);
  return (
    <>
      <div className="settings-field">
        <label className="settings-field-label" htmlFor={`${idPrefix}-provider`}>Provider</label>
        <select
          id={`${idPrefix}-provider`}
          className="settings-select"
          value={provider}
          onChange={(e) => onChange({ provider: e.target.value })}
        >
          {PROVIDER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      <div className="settings-field">
        <label className="settings-field-label" htmlFor={`${idPrefix}-model`}>Model</label>
        <input
          id={`${idPrefix}-model`}
          className="settings-input"
          type="text"
          value={model}
          placeholder={modelPlaceholder}
          onChange={(e) => onChange({ model: e.target.value })}
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      <div className="settings-field">
        <label className="settings-field-label" htmlFor={`${idPrefix}-key`}>API key</label>
        <div className="settings-input-row">
          <input
            id={`${idPrefix}-key`}
            className="settings-input"
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            onChange={(e) => onChange({ apiKey: e.target.value })}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
          />
          <button
            type="button"
            className="settings-input-toggle"
            onClick={() => setShowKey((v) => !v)}
          >
            {showKey ? 'Hide' : 'Show'}
          </button>
        </div>
      </div>
    </>
  );
}

export default function AgentChatSection({ codingAgent, onCodingAgentChange }) {
  const caProvider = codingAgent?.provider ?? AI_PROVIDERS.ANTHROPIC;
  const caModel = codingAgent?.model ?? '';
  const caApiKey = codingAgent?.apiKey ?? '';
  const caSystemPrompt = codingAgent?.systemPrompt ?? '';
  const caSkills = codingAgent?.skills ?? { global: {}, workspaces: {} };
  const updateCa = (patch) => onCodingAgentChange?.({
    provider: caProvider,
    model: caModel,
    apiKey: caApiKey,
    systemPrompt: caSystemPrompt,
    skills: caSkills,
    ...patch,
  });

  // The "Reset to default" button pulls the current default from main
  // (electron/agentSystemPrompt.js) so the renderer doesn't keep its own copy.
  const [defaultPrompt, setDefaultPrompt] = useState('');
  useEffect(() => {
    let active = true;
    window.api.agent.getDefaultSystemPrompt().then((p) => {
      if (active) setDefaultPrompt(p ?? '');
    });
    return () => { active = false; };
  }, []);

  const isDefault = caSystemPrompt === defaultPrompt && defaultPrompt !== '';

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Agent Chat</h2>
      <p className="settings-section-desc">
        The chat sidebar agent can read, edit, and run commands inside your active workspace.
        API keys are encrypted on this machine using your OS keychain.
      </p>

      <h3 className="settings-subsection-title">LLM</h3>
      <ProviderModelKey
        idPrefix="coding-agent"
        provider={caProvider}
        model={caModel}
        apiKey={caApiKey}
        onChange={updateCa}
        modelPlaceholder={caProvider === AI_PROVIDERS.OPENAI ? 'gpt-4o' : 'claude-sonnet-4-5'}
      />

      <h3 className="settings-subsection-title" style={{ marginTop: 24 }}>System Prompt</h3>
      <p className="settings-tab-intro">
        Pre-filled on install. Edit freely; takes effect on the next chat session (hit reset in the
        sidebar to apply now).
      </p>
      <div className="settings-prompt-block">
        <textarea
          id="coding-agent-system-prompt"
          className="settings-textarea"
          value={caSystemPrompt}
          onChange={(e) => updateCa({ systemPrompt: e.target.value })}
          spellCheck={false}
          rows={12}
        />
        <div className="settings-prompt-footer">
          <span className="settings-prompt-state" data-state={isDefault ? 'default' : 'custom'}>
            {isDefault ? 'Default' : 'Customized'}
          </span>
          <button
            type="button"
            className="settings-button"
            onClick={() => updateCa({ systemPrompt: defaultPrompt })}
            disabled={isDefault || !defaultPrompt}
          >
            Reset to default
          </button>
        </div>
      </div>
    </div>
  );
}
