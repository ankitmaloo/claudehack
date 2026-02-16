# Color Contrast Guidelines

Ensuring sufficient contrast between text and background is critical for accessibility and readability.

## WCAG 2.1 Standards

### Minimum Contrast Ratios

**Level AA (Required):**
- **Normal text** (< 18pt or < 14pt bold): **4.5:1** minimum
- **Large text** (≥ 18pt or ≥ 14pt bold): **3:1** minimum
- **UI components and graphics**: **3:1** minimum

**Level AAA (Enhanced):**
- **Normal text**: **7:1** minimum
- **Large text**: **4.5:1** minimum

### What Counts as Text?

- Body text, headings, labels
- Button text
- Form input text
- Link text
- Navigation items

### What Doesn't Require Contrast?

- Logos
- Inactive/disabled UI components
- Decorative elements that convey no information
- Text in images (though should be avoided)

## Common Color Pairs (Light Mode)

| Foreground | Background | Ratio | Pass AA Normal | Pass AAA Normal |
|------------|------------|-------|----------------|-----------------|
| Black (#000) | White (#fff) | 21:1 | ✅ | ✅ |
| Dark Gray (#333) | White (#fff) | 12.6:1 | ✅ | ✅ |
| Medium Gray (#666) | White (#fff) | 5.7:1 | ✅ | ❌ |
| Light Gray (#999) | White (#fff) | 2.8:1 | ❌ | ❌ |
| Blue (#2563eb) | White (#fff) | 8.6:1 | ✅ | ✅ |
| Green (#16a34a) | White (#fff) | 4.6:1 | ✅ | ❌ |

## Common Color Pairs (Dark Mode)

| Foreground | Background | Ratio | Pass AA Normal | Pass AAA Normal |
|------------|------------|-------|----------------|-----------------|
| White (#fff) | Black (#000) | 21:1 | ✅ | ✅ |
| White (#fff) | Dark Gray (#222) | 16.1:1 | ✅ | ✅ |
| Light Gray (#e5e5e5) | Dark Gray (#222) | 11.8:1 | ✅ | ✅ |
| Medium Gray (#a3a3a3) | Dark Gray (#222) | 5.3:1 | ✅ | ❌ |
| Blue (#60a5fa) | Dark Gray (#222) | 7.2:1 | ✅ | ✅ |

## Checking Contrast

### Method 1: Online Tools

**WebAIM Contrast Checker:**
- URL: https://webaim.org/resources/contrastchecker/
- Input: Foreground color (hex), Background color (hex)
- Output: Contrast ratio, pass/fail for AA and AAA

**Coolors Contrast Checker:**
- URL: https://coolors.co/contrast-checker
- Features: Live preview, suggests adjustments

### Method 2: Browser DevTools

**Chrome DevTools:**
1. Inspect element
2. In Styles panel, click color swatch
3. View contrast ratio in color picker
4. ✅ or ❌ indicators for AA/AAA compliance

**Firefox DevTools:**
1. Inspect element
2. Accessibility panel → Check for issues
3. Shows contrast problems automatically

### Method 3: Python Script

Use the included `scripts/check_contrast.py`:

```bash
python scripts/check_contrast.py "#000000" "#ffffff"
# Output: Contrast ratio: 21.0:1 (Pass AA: ✅, Pass AAA: ✅)
```

### Method 4: Convert HSL to Check

If using HSL variables, convert to hex first:

```javascript
// In browser console
function hslToHex(h, s, l) {
  l /= 100;
  const a = s * Math.min(l, 1 - l) / 100;
  const f = n => {
    const k = (n + h / 30) % 12;
    const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Example: --primary: 221.2 83.2% 53.3%
hslToHex(221.2, 83.2, 53.3); // Returns hex value
```

## Common Mistakes

### Mistake 1: Insufficient Contrast on Interactive Elements

```tsx
// ❌ BAD: Light gray button on white background
<button className="bg-gray-200 text-gray-400">
  Click me
</button>

// ✅ GOOD: Strong contrast
<button className="bg-primary text-primary-foreground">
  Click me
</button>
```

### Mistake 2: Transparent Overlays

```tsx
// ❌ BAD: Text might not have enough contrast on varied backgrounds
<div className="bg-black/20">
  <p className="text-white/60">Text</p>
</div>

// ✅ GOOD: Ensure sufficient backdrop
<div className="bg-black/80 backdrop-blur">
  <p className="text-white">Text</p>
</div>
```

### Mistake 3: Colorful Backgrounds

```tsx
// ❌ BAD: Gradient backgrounds can cause contrast issues
<div className="bg-gradient-to-r from-purple-500 to-pink-500">
  <p className="text-white">May not pass contrast check</p>
</div>

// ✅ GOOD: Test at both ends of gradient, add text shadow if needed
<div className="bg-gradient-to-r from-purple-700 to-pink-700">
  <p className="text-white drop-shadow-lg">Better contrast</p>
</div>
```

### Mistake 4: Hover/Focus States

```tsx
// ❌ BAD: Hover state has poor contrast
<button className="bg-primary hover:bg-primary/50">
  Hover reduces contrast
</button>

// ✅ GOOD: Hover state maintains contrast
<button className="bg-primary hover:bg-primary/90">
  Hover darkens slightly
</button>
```

## Testing Your Theme

### Checklist for New Color Scheme

1. [ ] Test background + foreground contrast
2. [ ] Test primary + primary-foreground contrast
3. [ ] Test secondary + secondary-foreground contrast
4. [ ] Test muted + muted-foreground contrast
5. [ ] Test all button variants (default, outline, ghost)
6. [ ] Test hover states on all interactive elements
7. [ ] Test focus rings visibility
8. [ ] Test disabled states (should look disabled but readable)
9. [ ] Test links against their backgrounds
10. [ ] Test both light and dark modes

### Quick Test Component

```tsx
// Create this component to visually test all color combinations
function ContrastTest() {
  return (
    <div className="p-8 space-y-4">
      <div className="bg-background p-4 border">
        <p className="text-foreground">Background + Foreground</p>
      </div>
      <div className="bg-primary p-4">
        <p className="text-primary-foreground">Primary + Primary Foreground</p>
      </div>
      <div className="bg-secondary p-4">
        <p className="text-secondary-foreground">Secondary + Secondary Foreground</p>
      </div>
      <div className="bg-muted p-4">
        <p className="text-muted-foreground">Muted + Muted Foreground</p>
      </div>
      <div className="bg-accent p-4">
        <p className="text-accent-foreground">Accent + Accent Foreground</p>
      </div>
      <div className="bg-card p-4 border">
        <p className="text-card-foreground">Card + Card Foreground</p>
      </div>
    </div>
  );
}
```

## Automated Testing

### Using Playwright or Puppeteer

```typescript
// Example test to check contrast programmatically
import { test, expect } from '@playwright/test';

test('check button contrast', async ({ page }) => {
  await page.goto('http://localhost:5173');
  
  // Get computed styles
  const button = page.locator('button').first();
  const bgColor = await button.evaluate(el => 
    window.getComputedStyle(el).backgroundColor
  );
  const textColor = await button.evaluate(el => 
    window.getComputedStyle(el).color
  );
  
  // Check contrast (you'd need a contrast calculation function)
  const ratio = calculateContrast(bgColor, textColor);
  expect(ratio).toBeGreaterThanOrEqual(4.5);
});
```

## Resources

- **WCAG 2.1 Guidelines**: https://www.w3.org/WAI/WCAG21/quickref/#contrast-minimum
- **WebAIM Contrast Checker**: https://webaim.org/resources/contrastchecker/
- **Color Contrast Analyzer**: https://www.tpgi.com/color-contrast-checker/
- **Who Can Use**: https://www.whocanuse.com/ (shows how colors appear to people with different vision types)

## Golden Rules

1. **Always test contrast** before finalizing any color combination
2. **Test both light and dark modes** if you support them
3. **Never assume** a color combo has good contrast - always verify
4. **When in doubt, go darker** (or lighter in dark mode)
5. **Text shadows can help** but shouldn't be relied upon as primary solution
6. **Borders can help** differentiate elements when colors are similar
