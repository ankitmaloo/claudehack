---
name: vite-frontend-dev
description: Specialized workflow for building and modifying Vite + React + TypeScript frontends using shadcn/ui, Radix, and Tailwind. Use when working on frontend development tasks with an existing Vite project structure, implementing features, debugging UI issues, or modifying React components. CRITICAL - Always use subagents for any task to compartmentalize changes.
---

This skill guides creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Implement real working code with exceptional attention to aesthetic details and creative choices.

The user provides frontend requirements: a component, page, application, or interface to build. They may include context about the purpose, audience, or technical constraints.

## Design Thinking

Before coding, understand the context and commit to a BOLD aesthetic direction:
- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Pick an extreme: brutally minimal, maximalist chaos, retro-futuristic, organic/natural, luxury/refined, playful/toy-like, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian, etc. There are so many flavors to choose from. Use these for inspiration but design one that is true to the aesthetic direction.
- **Constraints**: Technical requirements (framework, performance, accessibility).
- **Differentiation**: What makes this UNFORGETTABLE? What's the one thing someone will remember?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work - the key is intentionality, not intensity.

Then implement working code (HTML/CSS/JS, React, Vue, etc.) that is:
- Production-grade and functional
- Visually striking and memorable
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail

## Frontend Aesthetics Guidelines

Focus on:
- **Typography**: Choose fonts that are beautiful, unique, and interesting. Avoid generic fonts like Arial and Inter; opt instead for distinctive choices that elevate the frontend's aesthetics; unexpected, characterful font choices. Pair a distinctive display font with a refined body font.
- **Color & Theme**: Commit to a cohesive aesthetic. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.
- **Motion**: Use animations for effects and micro-interactions. Prioritize CSS-only solutions for HTML. Use Motion library for React when available. Focus on high-impact moments: one well-orchestrated page load with staggered reveals (animation-delay) creates more delight than scattered micro-interactions. Use scroll-triggering and hover states that surprise.
- **Spatial Composition**: Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements. Generous negative space OR controlled density.
- **Backgrounds & Visual Details**: Create atmosphere and depth rather than defaulting to solid colors. Add contextual effects and textures that match the overall aesthetic. Apply creative forms like gradient meshes, noise textures, geometric patterns, layered transparencies, dramatic shadows, decorative borders, custom cursors, and grain overlays.

NEVER use generic AI-generated aesthetics like overused font families (Inter, Roboto, Arial, system fonts), cliched color schemes (particularly purple gradients on white backgrounds), predictable layouts and component patterns, and cookie-cutter design that lacks context-specific character.

Interpret creatively and make unexpected choices that feel genuinely designed for the context. No design should be the same. Vary between light and dark themes, different fonts, different aesthetics. NEVER converge on common choices (Space Grotesk, for example) across generations.

**IMPORTANT**: Match implementation complexity to the aesthetic vision. Maximalist designs need elaborate code with extensive animations and effects. Minimalist or refined designs need restraint, precision, and careful attention to spacing, typography, and subtle details. Elegance comes from executing the vision well.

Remember: Claude is capable of extraordinary creative work. Don't hold back, show what can truly be created when thinking outside the box and committing fully to a distinctive vision.


# Vite Frontend Development Workflow

This skill provides a specialized workflow for developing frontends with Vite, React, TypeScript, shadcn/ui, Radix, and Tailwind CSS.

## Core Principles

### 1. CRITICAL: Use Subagents for Everything

**SUPER IMPORTANT**: Use subagents wherever possible for ANY task. You can use up to 10 subagents at a time.

**Why subagents are critical:**
- Compartmentalize changes to specific functions/components
- Better context management for focused tasks
- Helps you (Claude) contextualize the changes
- Reduces risk of unintended side effects
- Makes debugging easier

**When to use subagents:**
- Implementing any new feature
- Modifying existing components
- Fixing bugs
- Adding styles or animations
- Writing utility functions
- Any code change, no matter how small

**How to use subagents:**
```
I'll create a subagent to implement the [specific feature].
[Use subagent tool to delegate the specific task with clear instructions]
```

### 2. Never Initialize Applications

**NEVER** initialize a new Vite/React application from scratch. If the user asks you to start a new project:
1. Stop and ask them to provide the base skeleton
2. Wait for them to share the project structure
3. Only then proceed with development

### 3. Project Structure Assumptions

Assume this standard Vite + React + TypeScript structure:
```
project/
├── src/
│   ├── components/
│   ├── lib/
│   │   └── utils.ts (shadcn utilities)
│   ├── App.tsx
│   └── main.tsx
├── public/
├── index.html
├── package.json
├── vite.config.ts
├── tailwind.config.js
├── tsconfig.json
└── components.json (shadcn config)
```

### 4. Theming with CSS Variables

**All theme colors MUST be controlled via CSS variables.** Never hardcode color values.

**Pattern to follow:**
```css
/* In your CSS (usually index.css or globals.css) */
:root {
  --background: 0 0% 100%;
  --foreground: 222.2 47.4% 11.2%;
  --primary: 221.2 83.2% 53.3%;
  --primary-foreground: 210 40% 98%;
  /* ... more variables */
}

.dark {
  --background: 222.2 84% 4.9%;
  --foreground: 210 40% 98%;
  /* ... dark mode overrides */
}
```

**In components:**
```tsx
// Use Tailwind classes that reference CSS variables
<div className="bg-background text-foreground">
  <button className="bg-primary text-primary-foreground">
    Click me
  </button>
</div>
```

See `references/theming.md` for complete theming patterns and examples.

### 5. Contrast is Critical

**Always ensure proper contrast between background and text colors.**

- Use the W3C WCAG 2.1 standards:
  - Normal text: minimum 4.5:1 contrast ratio
  - Large text (18pt+): minimum 3:1 contrast ratio
- Before finalizing any color combination, verify contrast
- See `references/contrast.md` for contrast checking methods

### 6. Keep Code Simple and Debuggable

**Don't over-abstract. Don't over-complicate.**

**Bad (over-abstracted):**
```tsx
const DynamicComponent = createFactory(componentMap[type])(props);
```

**Good (clear and debuggable):**
```tsx
{type === 'button' && <Button {...props} />}
{type === 'input' && <Input {...props} />}
```

**Principles:**
- Explicit is better than implicit
- Direct component usage over factories/HOCs
- Clear prop drilling over complex context chains
- Simple conditional rendering over dynamic component maps

### 7. Minimal Changes, Focused Features

When implementing a feature:
1. Identify the MINIMUM files that need to change
2. Make changes ONLY to those files
3. Provide a clear way to test the feature immediately
4. Don't refactor unrelated code

**Pattern:**
```
Feature: Add dark mode toggle
Changes needed:
- src/components/ThemeToggle.tsx (NEW)
- src/App.tsx (add <ThemeToggle />)
That's it. Don't touch other components.

Testing: Open the app, click the toggle in top-right corner.
```

### 8. Visual Enhancements (Use Sparingly)

Modern UI patterns are good, but don't overdo it:
- ✅ Subtle shadows for depth
- ✅ Minimal glassmorphism for overlays
- ✅ Smooth transitions (200-300ms)
- ✅ Gradient accents (not entire backgrounds)
- ❌ Excessive animations
- ❌ Heavy glassmorphism everywhere
- ❌ Overly complex gradients

**Minimal is still good.** Don't feel pressured to add effects if the design works without them.

### 9. Testing with Chrome DevTools

If chrome-devtools MCP is available:
1. Server is usually already running (check first)
2. Open the page in chrome-devtools
3. Take a screenshot
4. Analyze the actual rendered output
5. Make adjustments based on what you see

**Pattern:**
```
Let me check how this looks in the browser:
[Use chrome-devtools to open localhost:5173]
[Take screenshot]
[Analyze and adjust]
```

### 10. Be Careful with Deletions

**Hard to figure out regressions in a sea of changes.**

Before deleting:
- Are you SURE this code/component isn't used elsewhere?
- Search the codebase for references
- Consider commenting out first instead of deleting
- Document what you're removing and why

## Development Workflow

### Step 1: Understand the Request
- What feature needs to be built?
- What files will be affected?
- What's the minimal scope?

### Step 2: Use Subagents
- Break down the task into focused subtasks
- Create a subagent for each subtask
- Give clear, specific instructions

### Step 3: Implement with Minimal Changes
- Change only what's necessary
- Keep abstractions simple
- Maintain existing patterns

### Step 4: Verify Contrast and Theming
- Check all color combinations
- Ensure CSS variables are used
- Verify both light and dark modes

### Step 5: Provide Testing Instructions
- Give clear steps to test the feature
- Specify what to look for
- Mention any edge cases

## Common Patterns

### Adding a New Component

```tsx
// src/components/MyComponent.tsx
import { cn } from "@/lib/utils";

interface MyComponentProps {
  // Explicit props, no magic
  className?: string;
  children: React.ReactNode;
}

export function MyComponent({ className, children }: MyComponentProps) {
  return (
    <div className={cn("bg-background text-foreground p-4", className)}>
      {children}
    </div>
  );
}
```

### Using shadcn Components

```tsx
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function MyFeature() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Title</CardTitle>
      </CardHeader>
      <CardContent>
        <Button>Click me</Button>
      </CardContent>
    </Card>
  );
}
```

### State Management (Keep it Simple)

```tsx
// Simple local state for most cases
const [value, setValue] = useState("");

// Context only when truly needed across many components
// Don't create context for everything
```

## Technology Reference

- **Vite**: Fast build tool and dev server
- **React 18**: UI library with hooks
- **TypeScript**: Type safety
- **Tailwind CSS**: Utility-first CSS framework
- **shadcn/ui**: Copy-paste component library (not npm package)
- **Radix UI**: Unstyled, accessible component primitives
- **Lucide React**: Icon library

## Additional Resources

- **Theming patterns**: See `references/theming.md`
- **Contrast guidelines**: See `references/contrast.md`
- **Component patterns**: See `references/component-patterns.md`
