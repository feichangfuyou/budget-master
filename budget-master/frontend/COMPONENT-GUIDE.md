# Component Guide - Budget Master

## Component Architecture

This guide provides a detailed overview of each component in the Budget Master application.

---

## Core Layout Components

### `App.tsx`
**Purpose:** Main application container with view routing and state management

**Features:**
- View routing (Overview, Transactions, Forecasts, Alerts)
- Global state management
- WebSocket connection for real-time updates
- API integration for all endpoints
- Loading state coordination

**Props:** None (root component)

**State:**
- `activeView`: Current navigation view
- `transactions`: Array of transaction objects
- `anomalies`: Array of anomaly alerts
- `forecasts`: Array of budget forecasts
- `metrics`: System metrics (uptime, memory)
- `chatResponse`: Current AI chat response
- `loading`: Loading states for different sections
- `error`: Global error message

---

### `Sidebar.tsx`
**Purpose:** Left navigation sidebar with view switching

**Features:**
- 4 navigation items (Overview, Transactions, Forecasts, Alerts)
- Responsive mobile menu with overlay
- Active state highlighting
- Help section at bottom
- Smooth transitions

**Props:**
```typescript
interface SidebarProps {
  activeView: string;          // Current active view ID
  onViewChange: (view: string) => void;  // View change handler
}
```

**Views:**
- `overview` - Dashboard home
- `transactions` - Transaction list
- `forecasts` - Budget predictions
- `alerts` - Anomaly alerts

---

### `Header.tsx`
**Purpose:** Top application header with branding and metrics

**Features:**
- App logo and title
- System uptime display (hours and minutes)
- Responsive sizing
- Elegant Cinzel font for title

**Props:**
```typescript
interface HeaderProps {
  uptime?: number;  // Uptime in seconds
}
```

---

## Data Display Components

### `StatsGrid.tsx`
**Purpose:** 4-column statistics dashboard

**Features:**
- Total spent with currency formatting
- Transaction count
- Average transaction amount
- Top spending category
- Color-coded icons for each stat
- Responsive grid (4 cols desktop, 2 cols tablet, 1 col mobile)

**Props:**
```typescript
interface StatsGridProps {
  totalSpent: number;
  transactionCount: number;
  averageTransaction: number;
  topCategory?: string;
}
```

**Color Coding:**
- Blue: Total spent (money icon)
- Green: Transaction count (document icon)
- Purple: Average (bar chart icon)
- Amber: Top category (tag icon)

---

### `SpendingChart.tsx`
**Purpose:** Horizontal bar chart showing spending by category

**Features:**
- Groups transactions by category
- Shows top 6 categories
- Percentage-based bar widths
- Color-coded bars
- Currency totals
- Empty state for no data

**Props:**
```typescript
interface SpendingChartProps {
  transactions: Transaction[];
}
```

**Colors:** Blue, Green, Purple, Amber, Pink, Indigo (rotating)

---

### `TransactionsTable.tsx`
**Purpose:** Comprehensive transaction list with sorting

**Features:**
- Table with 4 columns (Description, Category, Date, Amount)
- Hover effects on rows
- Category badges
- Merchant display
- Date formatting (MMM DD, YYYY)
- Currency formatting
- Refresh button
- Loading skeleton
- Empty state with helpful message

**Props:**
```typescript
interface TransactionsTableProps {
  transactions: Transaction[];
  onRefresh: () => void;
  isLoading?: boolean;
}
```

**Transaction Interface:**
```typescript
interface Transaction {
  id: string;
  date: string;
  amount: number;
  description: string;
  category?: string | null;
  merchant?: string | null;
}
```

---

## Alert & Forecast Components

### `AlertsSection.tsx`
**Purpose:** Display and manage anomaly alerts

**Features:**
- Severity badges (Low, Medium, High, Critical)
- Detailed explanations
- Recommendations in highlighted boxes
- Dismiss button
- Color-coded alerts (amber background)
- Empty state with green checkmark
- Loading skeletons

**Props:**
```typescript
interface AlertsSectionProps {
  anomalies: Anomaly[];
  onAcknowledge: (id: string) => void;
  isLoading?: boolean;
}
```

**Anomaly Interface:**
```typescript
interface Anomaly {
  id: string;
  transactionId: string;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  score: number;
  explanation: string;
  recommendation?: string | null;
  acknowledged: boolean;
}
```

---

### `SeverityBadge.tsx`
**Purpose:** Visual indicator for alert severity levels

**Features:**
- Color-coded badges with dots
- 4 severity levels
- Rounded pill style
- Border matching background

**Props:**
```typescript
interface SeverityBadgeProps {
  severity: 'low' | 'medium' | 'high' | 'critical';
}
```

**Colors:**
- Low: Amber (bg-amber-100, text-amber-800)
- Medium: Orange (bg-orange-100, text-orange-800)
- High: Red (bg-red-100, text-red-800)
- Critical: Dark Red (bg-red-200, text-red-900)

---

### `ForecastsSection.tsx`
**Purpose:** AI-powered budget forecast display

**Features:**
- Forecast cards in grid layout
- Trend descriptions
- 30-day estimates with confidence
- Recommendations list
- Generate button with loading state
- Empty state with icon
- Loading skeletons

**Props:**
```typescript
interface ForecastsSectionProps {
  forecasts: Forecast[];
  onGenerate: () => void;
  isLoading?: boolean;
}
```

**Forecast Interface:**
```typescript
interface Forecast {
  id?: string;
  category: string;
  predictions?: Array<{
    date: string;
    predicted: number;
    confidence: { lower: number; upper: number };
  }>;
  trend: string;
  recommendations?: string[];
}
```

---

## Interaction Components

### `ChatBar.tsx`
**Purpose:** Fixed bottom chat interface

**Features:**
- Text input with placeholder
- Send button with loading state
- File upload button for receipts
- Responsive layout
- Submit on Enter key
- Disabled state when submitting
- Icon indicators

**Props:**
```typescript
interface ChatBarProps {
  onSubmit: (query: string) => Promise<void>;
  onFileUpload: (file: File) => Promise<void>;
}
```

**Behavior:**
- Clears input after submit
- Shows loading spinner while processing
- Accepts image files only
- Resets file input after upload

---

### `ChatResponse.tsx`
**Purpose:** Display AI chat responses

**Features:**
- Blue-tinted card design
- Lightbulb icon indicator
- Dismiss button
- Whitespace preservation
- Smooth appearance

**Props:**
```typescript
interface ChatResponseProps {
  response: string;
  onDismiss?: () => void;
}
```

---

## Notification Components

### `ErrorBanner.tsx`
**Purpose:** Display error notifications

**Features:**
- Red-tinted alert design
- Warning icon
- Dismiss button
- Positioned below header
- Clear, readable text

**Props:**
```typescript
interface ErrorBannerProps {
  message: string;
  onDismiss?: () => void;
}
```

---

### `SummaryCard.tsx` (Legacy)
**Purpose:** Single-stat financial summary

**Note:** This component is now superseded by `StatsGrid.tsx` which provides more comprehensive statistics. Kept for backward compatibility.

**Props:**
```typescript
interface SummaryCardProps {
  totalSpent: number;
  transactionCount: number;
  isLoading?: boolean;
}
```

---

## Utility Functions

### `lib/utils.ts`

#### `cn(...inputs: ClassValue[])`
**Purpose:** Merge Tailwind classes with conflict resolution

**Usage:**
```typescript
import { cn } from './lib/utils';

<div className={cn(
  'base-class',
  condition && 'conditional-class',
  'override-class'
)} />
```

#### `formatCurrency(n: number)`
**Purpose:** Format numbers as USD currency

**Usage:**
```typescript
import { formatCurrency } from './lib/utils';

formatCurrency(1234.56)  // "$1,234.56"
```

---

## Component Composition Examples

### Overview Page
```typescript
<StatsGrid {...metrics} />
<SpendingChart transactions={transactions} />
<AlertsSection anomalies={alerts.slice(0, 3)} />
<ForecastsSection forecasts={forecasts} />
```

### Transactions Page
```typescript
<StatsGrid {...metrics} />
<TransactionsTable 
  transactions={transactions}
  onRefresh={fetchTransactions}
/>
```

### Alerts Page
```typescript
<AlertsSection 
  anomalies={anomalies}
  onAcknowledge={acknowledgeAnomaly}
/>
```

### Forecasts Page
```typescript
<ForecastsSection 
  forecasts={forecasts}
  onGenerate={generateForecast}
/>
```

---

## Styling Patterns

### Cards
```typescript
className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
```

### Buttons (Primary)
```typescript
className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
```

### Buttons (Secondary)
```typescript
className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
```

### Section Headers
```typescript
className="text-balance text-base font-semibold text-gray-900"
```

### Empty States
```typescript
className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center"
```

---

## Best Practices

1. **Always use `tabular-nums` for numeric data**
   ```typescript
   className="text-2xl font-bold tabular-nums"
   ```

2. **Use `text-balance` for headings**
   ```typescript
   className="text-balance text-xl font-semibold"
   ```

3. **Use `text-pretty` for paragraphs**
   ```typescript
   className="text-pretty text-sm text-gray-600"
   ```

4. **Include loading states**
   ```typescript
   {isLoading ? <Skeleton /> : <Content />}
   ```

5. **Provide empty states**
   ```typescript
   {items.length === 0 ? <EmptyState /> : <ItemList />}
   ```

6. **Add aria-labels to icon buttons**
   ```typescript
   <button aria-label="Dismiss alert">...</button>
   ```

---

## Quick Reference

### Component Hierarchy
```
App
├── Sidebar
├── Header
├── ErrorBanner (conditional)
├── ChatResponse (conditional)
├── Main Content
│   ├── StatsGrid
│   ├── SpendingChart
│   ├── AlertsSection
│   │   └── SeverityBadge
│   ├── ForecastsSection
│   └── TransactionsTable
└── ChatBar
```

### File Sizes (approximate)
- App.tsx: 350 lines
- Sidebar.tsx: 100 lines
- TransactionsTable.tsx: 110 lines
- AlertsSection.tsx: 100 lines
- ForecastsSection.tsx: 110 lines
- Other components: 50-80 lines each

### Import Statement
```typescript
import { ComponentName } from './components/ComponentName';
```

---

**Last Updated:** February 8, 2026
