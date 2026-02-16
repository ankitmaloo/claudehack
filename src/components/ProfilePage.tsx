import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { fetchUserProfile, updateUserProfile, type UserProfile } from '@/lib/firestore';
import { useAppSelector, useAppDispatch } from '@/store';
import { setApiKey, removeApiKey, type ApiProvider } from '@/store/slices/apiKeysSlice';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Eye, EyeOff, Key, User, Check, X, ArrowLeft, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// --- API Keys tab ---

const PROVIDERS: { id: ApiProvider; label: string; placeholder: string }[] = [
  { id: 'gemini', label: 'Gemini', placeholder: 'AIza...' },
  { id: 'openai', label: 'OpenAI', placeholder: 'sk-...' },
  { id: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-...' },
];

function ApiKeyRow({ provider }: { provider: typeof PROVIDERS[number] }) {
  const dispatch = useAppDispatch();
  const storedKey = useAppSelector((s) => s.apiKeys[provider.id]);

  const [inputValue, setInputValue] = useState(storedKey ?? '');
  const [visible, setVisible] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  const handleSave = useCallback(() => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    dispatch(setApiKey({ provider: provider.id, key: trimmed }));
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  }, [inputValue, provider.id, dispatch]);

  const handleClear = useCallback(() => {
    dispatch(removeApiKey(provider.id));
    setInputValue('');
  }, [provider.id, dispatch]);

  const hasKey = !!storedKey;
  const isDirty = inputValue.trim() !== (storedKey ?? '');

  return (
    <div className="flex flex-col gap-2 p-4 rounded-lg border border-border/50 bg-muted/20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Key className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">{provider.label}</span>
          {hasKey && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
              Configured
            </span>
          )}
        </div>
        {savedFlash && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
            <Check className="w-3 h-3" /> Saved
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            type={visible ? 'text' : 'password'}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={provider.placeholder}
            className="pr-9 font-mono text-sm"
          />
          <button
            type="button"
            onClick={() => setVisible(!visible)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
          >
            {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleSave}
          disabled={!inputValue.trim() || !isDirty}
          className="shrink-0"
        >
          Save
        </Button>

        {hasKey && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            className="shrink-0 text-destructive hover:text-destructive"
          >
            <X className="w-4 h-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

// --- Profile tab ---

type ProfileFields = Pick<UserProfile, 'displayName' | 'fullName' | 'title' | 'company' | 'bio'>;

const FIELD_DEFS: { key: keyof ProfileFields; label: string; placeholder: string; multiline?: boolean }[] = [
  { key: 'displayName', label: 'Display Name', placeholder: 'How you appear in the app' },
  { key: 'fullName', label: 'Full Name', placeholder: 'Your full name' },
  { key: 'title', label: 'Title', placeholder: 'e.g. Product Manager' },
  { key: 'company', label: 'Company', placeholder: 'Where you work' },
  { key: 'bio', label: 'Bio', placeholder: 'A short bio about yourself', multiline: true },
];

function ProfileTab() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [fields, setFields] = useState<ProfileFields>({
    displayName: null,
    fullName: null,
    title: null,
    company: null,
    bio: null,
  });
  const [original, setOriginal] = useState<ProfileFields>(fields);

  // Load profile from Firestore
  useEffect(() => {
    if (!user?.uid) return;
    let cancelled = false;
    setLoading(true);
    fetchUserProfile(user.uid)
      .then((profile) => {
        if (cancelled) return;
        if (profile) {
          const loaded: ProfileFields = {
            displayName: profile.displayName,
            fullName: profile.fullName,
            title: profile.title,
            company: profile.company,
            bio: profile.bio,
          };
          setFields(loaded);
          setOriginal(loaded);
        }
      })
      .catch((err) => console.error('Failed to load profile:', err))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [user?.uid]);

  const isDirty = JSON.stringify(fields) !== JSON.stringify(original);
  const hasProfile = FIELD_DEFS.some((d) => original[d.key]);

  const handleSave = useCallback(async () => {
    if (!user?.uid || !isDirty) return;
    setSaving(true);
    try {
      await updateUserProfile(user.uid, fields);
      setOriginal(fields);
      setEditing(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2000);
    } catch (err) {
      console.error('Failed to save profile:', err);
    } finally {
      setSaving(false);
    }
  }, [user?.uid, fields, isDirty]);

  const handleCancel = useCallback(() => {
    setFields(original);
    setEditing(false);
  }, [original]);

  const updateField = useCallback((key: keyof ProfileFields, value: string) => {
    setFields((prev) => ({ ...prev, [key]: value || null }));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Profile summary card */}
      {!editing && (
        <div className="p-5 rounded-lg border border-border/50 bg-muted/20 space-y-4">
          {/* Avatar + primary info */}
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <span className="text-lg font-serif font-medium text-primary">
                {(original.displayName || original.fullName || user?.email || '?')[0].toUpperCase()}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-medium truncate">
                {original.fullName || original.displayName || 'No name set'}
              </h2>
              {(original.title || original.company) && (
                <p className="text-sm text-muted-foreground mt-0.5">
                  {[original.title, original.company].filter(Boolean).join(' at ')}
                </p>
              )}
              <p className="text-xs text-muted-foreground mt-0.5">{user?.email}</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)} className="shrink-0 text-xs">
              Edit
            </Button>
          </div>

          {original.bio && (
            <p className="text-sm text-muted-foreground leading-relaxed">{original.bio}</p>
          )}

          {/* Detail rows for fields that have data */}
          {!hasProfile && (
            <p className="text-sm text-muted-foreground italic">
              No profile info yet.{' '}
              <button onClick={() => setEditing(true)} className="underline hover:text-foreground transition-colors">
                Add details
              </button>
            </p>
          )}

          {savedFlash && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <Check className="w-3.5 h-3.5" /> Profile saved
            </span>
          )}
        </div>
      )}

      {/* Edit form */}
      {editing && (
        <div className="p-5 rounded-lg border border-border/50 bg-muted/20 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">Edit Profile</h3>
            <button onClick={handleCancel} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              Cancel
            </button>
          </div>

          {/* Email (read-only) */}
          <div>
            <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1.5 block">Email</label>
            <p className="text-sm text-muted-foreground px-3 py-2">{user?.email ?? 'Not set'}</p>
          </div>

          {FIELD_DEFS.map((def) => (
            <div key={def.key}>
              <label className="text-xs text-muted-foreground uppercase tracking-wider mb-1.5 block">
                {def.label}
              </label>
              {def.multiline ? (
                <textarea
                  value={fields[def.key] ?? ''}
                  onChange={(e) => updateField(def.key, e.target.value)}
                  placeholder={def.placeholder}
                  rows={3}
                  className={cn(
                    "w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
                    "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    "resize-none"
                  )}
                />
              ) : (
                <Input
                  value={fields[def.key] ?? ''}
                  onChange={(e) => updateField(def.key, e.target.value)}
                  placeholder={def.placeholder}
                />
              )}
            </div>
          ))}

          <div className="flex items-center gap-3 pt-2">
            <Button onClick={handleSave} disabled={!isDirty || saving} size="sm">
              {saving ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-1.5" /> Saving...</>
              ) : (
                'Save Changes'
              )}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      <hr className="border-border/50" />

      <Button
        variant="outline"
        onClick={() => signOut(auth)}
        className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
      >
        Sign out
      </Button>
    </div>
  );
}

// --- Page ---

export function ProfilePage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background paper-texture">
      <div className="max-w-2xl mx-auto px-8 py-12">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        <h1 className="text-2xl font-serif tracking-tight mb-8">Profile</h1>

        <Tabs defaultValue="profile" className="w-full">
          <TabsList>
            <TabsTrigger value="profile" className="gap-1.5">
              <User className="w-4 h-4" />
              Profile
            </TabsTrigger>
            <TabsTrigger value="api-keys" className="gap-1.5">
              <Key className="w-4 h-4" />
              API Keys
            </TabsTrigger>
          </TabsList>

          <TabsContent value="profile" className="mt-6">
            <ProfileTab />
          </TabsContent>

          <TabsContent value="api-keys" className="mt-6">
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground mb-4">
                Add your API keys to use different providers. Keys are stored locally in your browser.
              </p>
              {PROVIDERS.map((p) => (
                <ApiKeyRow key={p.id} provider={p} />
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
