# shadcn/ui + Radix Quick Reference

Quick patterns for common UI components using shadcn/ui and Radix primitives.

## Installation

shadcn components are added one-by-one (they're just copied into your project):

```bash
npx shadcn@latest add button
npx shadcn@latest add card
npx shadcn@latest add input
# etc.
```

## Common Component Patterns

### Buttons

```tsx
import { Button } from "@/components/ui/button";

// Variants
<Button variant="default">Default</Button>
<Button variant="destructive">Delete</Button>
<Button variant="outline">Outline</Button>
<Button variant="secondary">Secondary</Button>
<Button variant="ghost">Ghost</Button>
<Button variant="link">Link</Button>

// Sizes
<Button size="sm">Small</Button>
<Button size="default">Default</Button>
<Button size="lg">Large</Button>
<Button size="icon"><Icon /></Button>

// With Icons
import { ChevronRight, Loader2 } from "lucide-react";
<Button>
  Next <ChevronRight className="ml-2 h-4 w-4" />
</Button>

// Loading State
<Button disabled>
  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
  Loading...
</Button>
```

### Cards

```tsx
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

<Card>
  <CardHeader>
    <CardTitle>Card Title</CardTitle>
    <CardDescription>Card description text</CardDescription>
  </CardHeader>
  <CardContent>
    <p>Main content goes here</p>
  </CardContent>
  <CardFooter>
    <Button>Action</Button>
  </CardFooter>
</Card>
```

### Forms

```tsx
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

<div className="space-y-4">
  <div className="space-y-2">
    <Label htmlFor="name">Name</Label>
    <Input id="name" placeholder="Enter your name" />
  </div>
  
  <div className="space-y-2">
    <Label htmlFor="email">Email</Label>
    <Input id="email" type="email" placeholder="you@example.com" />
  </div>
  
  <div className="space-y-2">
    <Label htmlFor="message">Message</Label>
    <Textarea id="message" placeholder="Your message..." />
  </div>
</div>
```

### Dialogs/Modals

```tsx
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

<Dialog>
  <DialogTrigger asChild>
    <Button>Open Dialog</Button>
  </DialogTrigger>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>Dialog Title</DialogTitle>
      <DialogDescription>
        Dialog description or instructions
      </DialogDescription>
    </DialogHeader>
    <div>
      {/* Dialog content */}
    </div>
    <DialogFooter>
      <Button variant="outline">Cancel</Button>
      <Button>Confirm</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### Dropdowns

```tsx
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="outline">Open Menu</Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent>
    <DropdownMenuLabel>My Account</DropdownMenuLabel>
    <DropdownMenuSeparator />
    <DropdownMenuItem>Profile</DropdownMenuItem>
    <DropdownMenuItem>Settings</DropdownMenuItem>
    <DropdownMenuSeparator />
    <DropdownMenuItem>Log out</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

### Tabs

```tsx
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

<Tabs defaultValue="account">
  <TabsList>
    <TabsTrigger value="account">Account</TabsTrigger>
    <TabsTrigger value="password">Password</TabsTrigger>
  </TabsList>
  <TabsContent value="account">
    Account settings content
  </TabsContent>
  <TabsContent value="password">
    Password settings content
  </TabsContent>
</Tabs>
```

### Select (Dropdown)

```tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

<Select>
  <SelectTrigger className="w-[180px]">
    <SelectValue placeholder="Select an option" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="option1">Option 1</SelectItem>
    <SelectItem value="option2">Option 2</SelectItem>
    <SelectItem value="option3">Option 3</SelectItem>
  </SelectContent>
</Select>
```

### Toast Notifications

```tsx
import { useToast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";

function MyComponent() {
  const { toast } = useToast();

  return (
    <Button
      onClick={() => {
        toast({
          title: "Success",
          description: "Your action was completed.",
        });
      }}
    >
      Show Toast
    </Button>
  );
}

// Error toast
toast({
  variant: "destructive",
  title: "Error",
  description: "Something went wrong.",
});
```

### Badges

```tsx
import { Badge } from "@/components/ui/badge";

<Badge>Default</Badge>
<Badge variant="secondary">Secondary</Badge>
<Badge variant="outline">Outline</Badge>
<Badge variant="destructive">Destructive</Badge>
```

### Skeleton Loaders

```tsx
import { Skeleton } from "@/components/ui/skeleton";

<div className="space-y-2">
  <Skeleton className="h-4 w-[250px]" />
  <Skeleton className="h-4 w-[200px]" />
  <Skeleton className="h-32 w-full" />
</div>
```

### Tooltips

```tsx
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

<TooltipProvider>
  <Tooltip>
    <TooltipTrigger asChild>
      <Button variant="outline">Hover me</Button>
    </TooltipTrigger>
    <TooltipContent>
      <p>Tooltip content</p>
    </TooltipContent>
  </Tooltip>
</TooltipProvider>
```

### Popover

```tsx
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

<Popover>
  <PopoverTrigger asChild>
    <Button variant="outline">Open popover</Button>
  </PopoverTrigger>
  <PopoverContent>
    <div className="space-y-2">
      <h4 className="font-medium">Popover Title</h4>
      <p className="text-sm text-muted-foreground">
        Popover content goes here
      </p>
    </div>
  </PopoverContent>
</Popover>
```

### Alerts

```tsx
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle } from "lucide-react";

<Alert>
  <AlertCircle className="h-4 w-4" />
  <AlertTitle>Heads up!</AlertTitle>
  <AlertDescription>
    You can add components to your app using the cli.
  </AlertDescription>
</Alert>

// Destructive variant
<Alert variant="destructive">
  <AlertCircle className="h-4 w-4" />
  <AlertTitle>Error</AlertTitle>
  <AlertDescription>
    Something went wrong.
  </AlertDescription>
</Alert>
```

### Data Tables (Basic)

```tsx
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Name</TableHead>
      <TableHead>Email</TableHead>
      <TableHead>Role</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    {users.map((user) => (
      <TableRow key={user.id}>
        <TableCell>{user.name}</TableCell>
        <TableCell>{user.email}</TableCell>
        <TableCell>{user.role}</TableCell>
      </TableRow>
    ))}
  </TableBody>
</Table>
```

## Radix Primitives (When shadcn isn't enough)

Sometimes you need more control. Use Radix primitives directly:

### Accordion (Custom)

```tsx
import * as Accordion from "@radix-ui/react-accordion";
import { ChevronDown } from "lucide-react";

<Accordion.Root type="single" collapsible>
  <Accordion.Item value="item-1">
    <Accordion.Trigger className="flex items-center justify-between w-full">
      <span>Trigger 1</span>
      <ChevronDown className="h-4 w-4" />
    </Accordion.Trigger>
    <Accordion.Content>
      Content 1
    </Accordion.Content>
  </Accordion.Item>
</Accordion.Root>
```

### Switch

```tsx
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

<div className="flex items-center space-x-2">
  <Switch id="airplane-mode" />
  <Label htmlFor="airplane-mode">Airplane Mode</Label>
</div>
```

### Checkbox

```tsx
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

<div className="flex items-center space-x-2">
  <Checkbox id="terms" />
  <Label htmlFor="terms">Accept terms and conditions</Label>
</div>
```

### Radio Group

```tsx
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

<RadioGroup defaultValue="option1">
  <div className="flex items-center space-x-2">
    <RadioGroupItem value="option1" id="option1" />
    <Label htmlFor="option1">Option 1</Label>
  </div>
  <div className="flex items-center space-x-2">
    <RadioGroupItem value="option2" id="option2" />
    <Label htmlFor="option2">Option 2</Label>
  </div>
</RadioGroup>
```

## Lucide Icons

```tsx
import { 
  ChevronRight, 
  User, 
  Settings, 
  Search,
  Menu,
  X,
  Check,
  AlertCircle,
  Loader2,
} from "lucide-react";

// Basic usage
<Search className="h-4 w-4" />
<User className="h-5 w-5 text-muted-foreground" />

// With animation
<Loader2 className="h-4 w-4 animate-spin" />

// Icon button
<Button size="icon">
  <Menu className="h-4 w-4" />
</Button>
```

## Common Utility Classes

```tsx
// Spacing
className="space-y-4"    // vertical spacing between children
className="space-x-4"    // horizontal spacing between children
className="gap-4"        // gap in flex/grid

// Flex
className="flex items-center justify-between"
className="flex flex-col gap-4"

// Grid
className="grid grid-cols-3 gap-4"
className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"

// Typography
className="text-sm text-muted-foreground"
className="text-lg font-semibold"
className="font-medium"

// Borders
className="border border-border rounded-lg"
className="border-b"

// Padding
className="p-4"
className="px-4 py-2"

// Background
className="bg-background"
className="bg-card"
className="bg-muted"
```

## Layout Patterns

### Container

```tsx
<div className="container mx-auto px-4 py-8">
  {/* Content */}
</div>
```

### Two Column Layout

```tsx
<div className="grid grid-cols-1 md:grid-cols-2 gap-8">
  <div>{/* Left column */}</div>
  <div>{/* Right column */}</div>
</div>
```

### Sidebar Layout

```tsx
<div className="flex min-h-screen">
  <aside className="w-64 border-r bg-card p-4">
    {/* Sidebar */}
  </aside>
  <main className="flex-1 p-8">
    {/* Main content */}
  </main>
</div>
```

## Resources

- shadcn/ui docs: https://ui.shadcn.com/docs/components
- Radix UI docs: https://www.radix-ui.com/primitives/docs/overview/introduction
- Lucide icons: https://lucide.dev/icons/
