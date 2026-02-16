import { configureStore } from '@reduxjs/toolkit';
import { useDispatch, useSelector, type TypedUseSelectorHook } from 'react-redux';
import authReducer from './slices/authSlice';
import runsReducer from './slices/runsSlice';
import apiKeysReducer from './slices/apiKeysSlice';
import { firestoreMiddleware } from './middleware/firestoreMiddleware';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    runs: runsReducer,
    apiKeys: apiKeysReducer,
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // SSEEvent arrays can be large; skip checking run data paths
        ignoredPaths: ['runs.runs'],
        ignoredActions: [
          'runs/createRun',
          'runs/updateRun',
          'runs/addEvents',
          'runs/setResult',
          'runs/setRunFromFirestore',
          'runs/updateVersion',
        ],
      },
    }).concat(firestoreMiddleware),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
