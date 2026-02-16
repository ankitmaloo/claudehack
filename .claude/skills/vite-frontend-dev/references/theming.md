# Theming with CSS Variables

Complete guide to implementing theming in Vite + React + Tailwind applications using CSS variables.

## Philosophy

**All colors should be controlled via CSS variables.** This enables:
- Easy theme switching (light/dark mode)
- Consistent color usage across the app
- Simple maintenance and updates
- Dynamic theming at runtime

## CSS Variable Structure

### Standard shadcn/ui Pattern

```css
@layer base {
  :root {
    /* Base colors */
    --background: 0 0% 100%;
    --foreground: 222.2 47.4% 11.2%;
    
    /* Card colors */
    --card: 0 0% 100%;
    --card-foreground: 222.2 47.4% 11.2%;
    
    /* Popover colors */
    --popover: 0 0% 100%;
    --popover-foreground: 222.2 47.4% 11.2%;
    
    /* Primary colors */
    --primary: 221.2 83.2% 53.3%;
    --primary-foreground: 210 40% 98%;
    
    /* Secondary colors */
    --secondary: 210 40% 96.1%;
    --secondary-foreground: 222.2 47.4% 11.2%;
    
    /* Muted colors */
    --muted: 210 40% 96.1%;
    --muted-foreground: 215.4 16.3% 46.9%;
    
    /* Accent colors */
    --accent: 210 40% 96.1%;
    --accent-foreground: 222.2 47.4% 11.2%;
    
    /* Destructive colors */
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;
    
    /* Border colors */
    --border: 214.3 31.8% 91.4%;
    --input: 214.3 31.8% 91.4%;
    
    /* Ring color (focus states) */
    --ring: 221.2 83.2% 53.3%;
    
    /* Chart colors */
    --chart-1: 12 76% 61%;
    --chart-2: 173 58% 39%;
    --chart-3: 197 37% 24%;
    --chart-4: 43 74% 66%;
    --chart-5: 27 87% 67%;
    
    /* Radius */
    --radius: 0.5rem;
  }
  
  .dark {
    /* Base colors */
    --background: 222.2 84% 4.9%;
    --foreground: 210 40% 98%;
    
    /* Card colors */
    --card: 222.2 84% 4.9%;
    --card-foreground: 210 40% 98%;
    
    /* Popover colors */
    --popover: 222.2 84% 4.9%;
    --popover-foreground: 210 40% 98%;
    
    /* Primary colors */
    --primary: 217.2 91.2% 59.8%;
    --primary-foreground: 222.2 47.4% 11.2%;
    
    /* Secondary colors */
    --secondary: 217.2 32.6% 17.5%;
    --secondary-foreground: 210 40% 98%;
    
    /* Muted colors */
    --muted: 217.2 32.6% 17.5%;
    --muted-foreground: 215 20.2% 65.1%;
    
    /* Accent colors */
    --accent: 217.2 32.6% 17.5%;
    --accent-foreground: 210 40% 98%;
    
    /* Destructive colors */
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;
    
    /* Border colors */
    --border: 217.2 32.6% 17.5%;
    --input: 217.2 32.6% 17.5%;
    
    /* Ring color (focus states) */
    --ring: 224.3 76.3% 48%;
    
    /* Chart colors */
    --chart-1: 220 70% 50%;
    --chart-2: 160 60% 45%;
    --chart-3: 30 80% 55%;
    --chart-4: 280 65% 60%;
    --chart-5: 340 75% 55%;
  }
}
```

### HSL Format Explained

CSS variables use HSL (Hue, Saturation, Lightness) format WITHOUT the `hsl()` wrapper:
- `--primary: 221.2 83.2% 53.3%` → Hue: 221.2°, Saturation: 83.2%, Lightness: 53.3%
- This allows Tailwind to apply opacity: `bg-primary/50` → `hsla(221.2 83.2% 53.3% / 0.5)`

## Tailwind Configuration

```js
// tailwind.config.js
module.exports = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
```

## Usage in Components

### Basic Color Usage

```tsx
// Always use semantic color names, never hardcode
function MyComponent() {
  return (
    <div className="bg-background text-foreground">
      <h1 className="text-primary">Title</h1>
      <p className="text-muted-foreground">Description</p>
      <button className="bg-primary text-primary-foreground">
        Click me
      </button>
    </div>
  );
}
```

### With Opacity

```tsx
// Tailwind allows opacity with /[value]
<div className="bg-primary/50">50% opacity</div>
<div className="bg-primary/20">20% opacity</div>
<div className="text-foreground/70">70% opacity text</div>
```

### Custom Colors (When Needed)

```css
/* In your CSS file */
:root {
  --success: 142 76% 36%;
  --success-foreground: 0 0% 100%;
  --warning: 38 92% 50%;
  --warning-foreground: 0 0% 100%;
}
```

```js
// Add to tailwind.config.js
colors: {
  success: {
    DEFAULT: "hsl(var(--success))",
    foreground: "hsl(var(--success-foreground))",
  },
  warning: {
    DEFAULT: "hsl(var(--warning))",
    foreground: "hsl(var(--warning-foreground))",
  },
}
```

## Dark Mode Implementation

### Basic Setup

```tsx
// src/components/ThemeProvider.tsx
import { createContext, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light" | "system";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const ThemeProviderContext = createContext<ThemeProviderState | undefined>(
  undefined
);

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = "ui-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
  );

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";
      root.classList.add(systemTheme);
      return;
    }

    root.classList.add(theme);
  }, [theme]);

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme);
      setTheme(theme);
    },
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);
  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider");
  return context;
};
```

### Theme Toggle Component

```tsx
// src/components/ThemeToggle.tsx
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/ThemeProvider";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(theme === "light" ? "dark" : "light")}
    >
      <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      <span className="sr-only">Toggle theme</span>
    </Button>
  );
}
```

## Best Practices

### DO ✅

```tsx
// Use semantic color names
<div className="bg-primary text-primary-foreground">

// Use CSS variables for dynamic colors
<div style={{ backgroundColor: `hsl(var(--custom))` }}>

// Apply opacity with Tailwind
<div className="bg-foreground/10">
```

### DON'T ❌

```tsx
// Never hardcode colors
<div className="bg-blue-500 text-white">

// Never use RGB or hex in inline styles
<div style={{ color: '#3b82f6' }}>

// Never bypass the theming system
<div style={{ backgroundColor: 'blue' }}>
```

## Advanced: Dynamic Theme Colors

```tsx
// For user-customizable themes
function setCustomPrimary(hue: number, saturation: number, lightness: number) {
  document.documentElement.style.setProperty(
    '--primary',
    `${hue} ${saturation}% ${lightness}%`
  );
}

// Example: Set primary to a custom purple
setCustomPrimary(270, 80, 50);
```

## Debugging Theme Colors

```tsx
// Add this to see all CSS variables in console
Object.entries(
  getComputedStyle(document.documentElement)
).filter(([key]) => key.startsWith('--'));
```
