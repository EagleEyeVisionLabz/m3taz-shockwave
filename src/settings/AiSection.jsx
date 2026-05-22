import React, { useState } from 'react';
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

export default function AiSection({ ai, onChange, codingAgent, onCodingAgentChange }) {
  const aiProvider = ai?.provider ?? AI_PROVIDERS.ANTHROPIC;
  const aiModel = ai?.model ?? '';
  const aiApiKey = ai?.apiKey ?? '';
  const includeContextByDefault = !!ai?.includeContextByDefault;
  const updateAi = (patch) => onChange({
    provider: aiProvider, model: aiModel, apiKey: aiApiKey, includeContextByDefault, ...patch,
  });

  const caProvider = codingAgent?.provider ?? AI_PROVIDERS.ANTHROPIC;
  const caModel = codingAgent?.model ?? '';
  const caApiKey = codingAgent?.apiKey ?? '';
  const updateCa = (patch) => onCodingAgentChange?.({
    provider: caProvider, model: caModel, apiKey: caApiKey, ...patch,
  });

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">AI / Coding Agent</h2>
      <p className="settings-section-desc">
        Configure the models for inline editing and the coding agent. API keys are stored
        locally on this machine.
      </p>

      <h3 className="settings-subsection-title">Inline AI</h3>
      <p className="settings-field-hint">Used by right-click "Insert AI Response" and "Rewrite with AI" in the editor.</p>
      <ProviderModelKey
        idPrefix="ai"
        provider={aiProvider}
        model={aiModel}
        apiKey={aiApiKey}
        onChange={updateAi}
        modelPlaceholder={aiProvider === AI_PROVIDERS.OPENAI ? 'gpt-4o' : 'claude-sonnet-4-5'}
      />

      <div className="settings-field">
        <label className="settings-checkbox-row">
          <input
            type="checkbox"
            checked={includeContextByDefault}
            onChange={(e) => updateAi({ includeContextByDefault: e.target.checked })}
          />
          <span>Include the rest of the document as context by default</span>
        </label>
        <p className="settings-field-hint">
          When checked, AI editing requests include the full document for context. You can still
          toggle this per request in the prompt window.
        </p>
      </div>

      <h3 className="settings-subsection-title">Coding Agent</h3>
      <p className="settings-field-hint">
        Powers the chat sidebar. The agent can read, edit, and run commands inside your active workspace.
      </p>
      <ProviderModelKey
        idPrefix="coding-agent"
        provider={caProvider}
        model={caModel}
        apiKey={caApiKey}
        onChange={updateCa}
        modelPlaceholder={caProvider === AI_PROVIDERS.OPENAI ? 'gpt-4o' : 'claude-sonnet-4-5'}
      />
    </div>
  );
}
