import React, { useState } from 'react';
import * as Tabs from '@radix-ui/react-tabs';
import { AI_PROVIDERS } from '../constants.js';
import AiSkillsTab from './AiSkillsTab.jsx';

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

export default function AiSection({ ai, onChange, codingAgent, onCodingAgentChange, activeWorkspaceId }) {
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
  const caSkills = codingAgent?.skills ?? { global: {}, workspaces: {} };
  const updateCa = (patch) => onCodingAgentChange?.({
    provider: caProvider, model: caModel, apiKey: caApiKey, skills: caSkills, ...patch,
  });
  const onSkillsChange = (nextSkills) => onCodingAgentChange?.({
    provider: caProvider, model: caModel, apiKey: caApiKey, skills: nextSkills,
  });

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">LLM / Agent</h2>
      <p className="settings-section-desc">
        Configure the models for inline editing and the Agent, and manage the skills the agent can use.
        API keys are stored locally on this machine.
      </p>

      <Tabs.Root defaultValue="inline" className="settings-tabs">
        <Tabs.List className="settings-tabs-list" aria-label="LLM / Agent settings">
          <Tabs.Trigger value="inline" className="settings-tab">Inline LLM</Tabs.Trigger>
          <Tabs.Trigger value="agent" className="settings-tab">Agent LLM</Tabs.Trigger>
          <Tabs.Trigger value="skills" className="settings-tab">Agent Skills</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="inline" className="settings-tab-content">
          <p className="settings-field-hint" style={{ marginTop: 0 }}>
            Used by right-click "Insert AI Response" and "Rewrite with AI" in the editor.
          </p>
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
        </Tabs.Content>

        <Tabs.Content value="agent" className="settings-tab-content">
          <p className="settings-field-hint" style={{ marginTop: 0 }}>
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
        </Tabs.Content>

        <Tabs.Content value="skills" className="settings-tab-content">
          <AiSkillsTab
            skills={caSkills}
            onSkillsChange={onSkillsChange}
            activeWorkspaceId={activeWorkspaceId}
          />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}
