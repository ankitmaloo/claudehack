# Component Patterns

Best practices for building React components that are simple, debuggable, and maintainable.

## Core Principle: Explicit Over Implicit

Always prefer code that is obvious and easy to understand over clever abstractions.

## Component Structure

### Basic Component Pattern

```tsx
// src/components/MyComponent.tsx
import { cn } from "@/lib/utils";

interface MyComponentProps {
  // Explicit props - no spreading random props
  title: string;
  description?: string;
  onClick?: () => void;
  className?: string;
  children?: React.ReactNode;
}

export function MyComponent({ 
  title, 
  description, 
  onClick,
  className,
  children 
}: MyComponentProps) {
  return (
    <div className={cn("p-4 rounded-lg bg-card", className)}>
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {description && (
        <p className="text-sm text-muted-foreground">{description}</p>
      )}
      {children}
      {onClick && (
        <button onClick={onClick} className="mt-4 px-4 py-2 bg-primary text-primary-foreground">
          Action
        </button>
      )}
    </div>
  );
}
```

### Key Points:
- Explicit prop interface
- Optional props marked with `?`
- Conditional rendering is clear
- className merging with `cn()`
- No magic or hidden behavior

## Conditional Rendering

### ✅ DO: Simple Conditionals

```tsx
// Clear and obvious
{isLoading && <LoadingSpinner />}
{error && <ErrorMessage error={error} />}
{data && <DataDisplay data={data} />}

// For more complex conditions
{status === 'idle' && <IdleState />}
{status === 'loading' && <LoadingState />}
{status === 'error' && <ErrorState />}
{status === 'success' && <SuccessState />}
```

### ❌ DON'T: Component Factories

```tsx
// Too clever, hard to debug
const componentMap = {
  idle: IdleState,
  loading: LoadingState,
  error: ErrorState,
  success: SuccessState,
};
const Component = componentMap[status];
return <Component />;

// Instead, use explicit conditionals (see above)
```

## State Management

### ✅ DO: Simple Local State

```tsx
function UserForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await submitUser({ name, email });
    } finally {
      setIsSubmitting(false);
    }
  };
  
  return (
    <form onSubmit={handleSubmit}>
      <input 
        value={name} 
        onChange={(e) => setName(e.target.value)}
      />
      <input 
        value={email} 
        onChange={(e) => setEmail(e.target.value)}
      />
      <button disabled={isSubmitting}>Submit</button>
    </form>
  );
}
```

### ✅ DO: useReducer for Complex State

```tsx
// Only when state updates are complex
type State = {
  items: Item[];
  filter: string;
  sortBy: 'name' | 'date';
  isLoading: boolean;
};

type Action = 
  | { type: 'SET_ITEMS'; items: Item[] }
  | { type: 'SET_FILTER'; filter: string }
  | { type: 'SET_SORT'; sortBy: 'name' | 'date' }
  | { type: 'SET_LOADING'; isLoading: boolean };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_ITEMS':
      return { ...state, items: action.items };
    case 'SET_FILTER':
      return { ...state, filter: action.filter };
    case 'SET_SORT':
      return { ...state, sortBy: action.sortBy };
    case 'SET_LOADING':
      return { ...state, isLoading: action.isLoading };
  }
}

function ItemList() {
  const [state, dispatch] = useReducer(reducer, initialState);
  // ...
}
```

### ❌ DON'T: Context for Everything

```tsx
// Don't create context unless truly needed across many components
// This is overkill for local state:
const UserFormContext = createContext(/* ... */);

// Just use props or local state instead
```

## Prop Passing

### ✅ DO: Explicit Prop Drilling (for 2-3 levels)

```tsx
// Parent
function Parent() {
  const [theme, setTheme] = useState("light");
  return <Child theme={theme} onThemeChange={setTheme} />;
}

// Child
function Child({ theme, onThemeChange }) {
  return <GrandChild theme={theme} onThemeChange={onThemeChange} />;
}

// GrandChild
function GrandChild({ theme, onThemeChange }) {
  return <button onClick={() => onThemeChange("dark")}>{theme}</button>;
}
```

### ✅ DO: Context for Deep Props (4+ levels)

```tsx
// Only create context when props need to go through many levels
const ThemeContext = createContext<{
  theme: string;
  setTheme: (theme: string) => void;
} | null>(null);

function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be within ThemeProvider");
  return context;
}
```

## Event Handlers

### ✅ DO: Clear Event Handlers

```tsx
function MyComponent() {
  const handleClick = () => {
    console.log("Clicked");
    // Do something
  };
  
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Handle form
  };
  
  return (
    <div>
      <button onClick={handleClick}>Click</button>
      <form onSubmit={handleSubmit}>...</form>
    </div>
  );
}
```

### ❌ DON'T: Inline Complex Logic

```tsx
// Don't do this - hard to debug
<button onClick={() => {
  setIsLoading(true);
  fetchData()
    .then(data => setData(data))
    .catch(err => setError(err))
    .finally(() => setIsLoading(false));
}}>
  Click
</button>

// Extract to named function instead
```

## shadcn/ui Component Usage

### ✅ DO: Use shadcn Components Directly

```tsx
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

function LoginForm() {
  return (
    <Card className="w-96">
      <CardHeader>
        <CardTitle>Login</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="space-y-4">
          <Input type="email" placeholder="Email" />
          <Input type="password" placeholder="Password" />
          <Button className="w-full">Sign In</Button>
        </form>
      </CardContent>
    </Card>
  );
}
```

### Variant Usage

```tsx
// Button variants
<Button variant="default">Default</Button>
<Button variant="destructive">Delete</Button>
<Button variant="outline">Outline</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="link">Link</Button>

// Button sizes
<Button size="default">Default</Button>
<Button size="sm">Small</Button>
<Button size="lg">Large</Button>
<Button size="icon"><Icon /></Button>
```

## Lists and Iteration

### ✅ DO: Simple map() with Keys

```tsx
function ItemList({ items }: { items: Item[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.id} className="p-2 bg-card rounded">
          {item.name}
        </li>
      ))}
    </ul>
  );
}
```

### ✅ DO: Extract Complex List Items

```tsx
function ItemList({ items }: { items: Item[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <ListItem key={item.id} item={item} />
      ))}
    </ul>
  );
}

function ListItem({ item }: { item: Item }) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  return (
    <li className="p-2 bg-card rounded">
      <button onClick={() => setIsExpanded(!isExpanded)}>
        {item.name}
      </button>
      {isExpanded && <div>{item.details}</div>}
    </li>
  );
}
```

## Data Fetching

### ✅ DO: Simple useEffect Pattern

```tsx
function UserProfile({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  
  useEffect(() => {
    let cancelled = false;
    
    async function fetchUser() {
      try {
        setIsLoading(true);
        const data = await getUserById(userId);
        if (!cancelled) {
          setUser(data);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err as Error);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }
    
    fetchUser();
    
    return () => {
      cancelled = true;
    };
  }, [userId]);
  
  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage error={error} />;
  if (!user) return <NotFound />;
  
  return <div>{user.name}</div>;
}
```

## Form Handling

### ✅ DO: Controlled Components

```tsx
function ContactForm() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    message: "",
  });
  
  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await submitForm(formData);
  };
  
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Input
        name="name"
        value={formData.name}
        onChange={handleChange}
        placeholder="Name"
      />
      <Input
        name="email"
        type="email"
        value={formData.email}
        onChange={handleChange}
        placeholder="Email"
      />
      <textarea
        name="message"
        value={formData.message}
        onChange={handleChange}
        placeholder="Message"
        className="w-full p-2 border rounded"
      />
      <Button type="submit">Send</Button>
    </form>
  );
}
```

## TypeScript Patterns

### ✅ DO: Explicit Types

```tsx
// Define clear interfaces
interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
}

interface UserCardProps {
  user: User;
  onEdit: (userId: string) => void;
  onDelete: (userId: string) => void;
}

// Use in component
function UserCard({ user, onEdit, onDelete }: UserCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{user.name}</CardTitle>
      </CardHeader>
      <CardContent>
        <p>{user.email}</p>
        <Button onClick={() => onEdit(user.id)}>Edit</Button>
        <Button onClick={() => onDelete(user.id)}>Delete</Button>
      </CardContent>
    </Card>
  );
}
```

### ❌ DON'T: Over-generic Types

```tsx
// Too generic, not helpful
function processData<T>(data: T): T {
  return data;
}

// Be specific about what you're working with
function processUser(user: User): User {
  return user;
}
```

## Testing Your Components

### Manual Testing Approach

```tsx
// Add a test route in your app for manual testing
// src/routes/ComponentTest.tsx
function ComponentTest() {
  return (
    <div className="p-8 space-y-8">
      <h1>Testing MyComponent</h1>
      
      <section>
        <h2>Default State</h2>
        <MyComponent title="Test" />
      </section>
      
      <section>
        <h2>With Description</h2>
        <MyComponent title="Test" description="This is a test" />
      </section>
      
      <section>
        <h2>With Action</h2>
        <MyComponent 
          title="Test" 
          onClick={() => alert('Clicked!')} 
        />
      </section>
    </div>
  );
}
```

## Anti-Patterns to Avoid

### 1. Over-abstraction
```tsx
// ❌ Don't
const renderComponent = (type: string, props: any) => {
  const Component = componentMap[type];
  return <Component {...props} />;
};

// ✅ Do
{type === 'card' && <Card {...props} />}
{type === 'list' && <List {...props} />}
```

### 2. Props Spreading
```tsx
// ❌ Don't
function MyComponent({ ...props }) {
  return <div {...props} />;
}

// ✅ Do
function MyComponent({ className, onClick, children }: MyComponentProps) {
  return <div className={className} onClick={onClick}>{children}</div>;
}
```

### 3. Unnecessary Memoization
```tsx
// ❌ Don't memoize everything
const MemoizedComponent = memo(() => <div>Simple</div>);

// ✅ Only memoize when there's a real performance issue
function ExpensiveList({ items }) {
  const sortedItems = useMemo(
    () => items.sort((a, b) => a.value - b.value),
    [items]
  );
  return <div>{sortedItems.map(/* ... */)}</div>;
}
```

## Summary

**Golden Rules:**
1. Be explicit - no magic
2. Keep components simple
3. Extract when complex, not prematurely
4. Use TypeScript properly
5. Test manually with real usage
6. Prefer clarity over cleverness
