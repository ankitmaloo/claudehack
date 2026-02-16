import { createSlice, createSelector, type PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '../index';

export type ApiProvider = 'gemini' | 'openai' | 'anthropic';

interface ApiKeysState {
  gemini: string | null;
  openai: string | null;
  anthropic: string | null;
}

const STORAGE_KEY = 'apiKeys';

function loadFromStorage(): ApiKeysState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        gemini: parsed.gemini ?? null,
        openai: parsed.openai ?? null,
        anthropic: parsed.anthropic ?? null,
      };
    }
  } catch {
    // ignore
  }
  return { gemini: null, openai: null, anthropic: null };
}

function persistToStorage(state: ApiKeysState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

const initialState: ApiKeysState = {
  gemini: null,
  openai: null,
  anthropic: null,
};

const apiKeysSlice = createSlice({
  name: 'apiKeys',
  initialState,
  reducers: {
    setApiKey(state, action: PayloadAction<{ provider: ApiProvider; key: string }>) {
      state[action.payload.provider] = action.payload.key;
      persistToStorage(state);
    },
    removeApiKey(state, action: PayloadAction<ApiProvider>) {
      state[action.payload] = null;
      persistToStorage(state);
    },
    loadApiKeys(state) {
      const loaded = loadFromStorage();
      state.gemini = loaded.gemini;
      state.openai = loaded.openai;
      state.anthropic = loaded.anthropic;
    },
  },
});

export const { setApiKey, removeApiKey, loadApiKeys } = apiKeysSlice.actions;

// Selectors
export const selectApiKeys = (state: RootState) => state.apiKeys;
export const selectHasAnyApiKey = (state: RootState) =>
  !!(state.apiKeys.gemini || state.apiKeys.openai || state.apiKeys.anthropic);
export const selectAvailableProviders = createSelector(
  [selectApiKeys],
  (keys): ApiProvider[] => {
    const providers: ApiProvider[] = [];
    if (keys.gemini) providers.push('gemini');
    if (keys.openai) providers.push('openai');
    if (keys.anthropic) providers.push('anthropic');
    return providers;
  }
);
export const selectDefaultProvider = createSelector(
  [selectApiKeys],
  (keys): ApiProvider | null => {
    if (keys.gemini) return 'gemini';
    if (keys.openai) return 'openai';
    if (keys.anthropic) return 'anthropic';
    return null;
  }
);

export default apiKeysSlice.reducer;
