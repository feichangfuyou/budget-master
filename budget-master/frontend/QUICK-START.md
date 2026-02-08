# Budget Master - Quick Start Guide

## 🚀 Getting Started

### Development Server

```bash
cd budget-master/frontend
npm install
npm run dev
```

The app will be available at `http://localhost:5177` (or next available port).

### Production Build

```bash
npm run build
npm run preview
```

## 📱 Application Features

### Main Views

The application has 4 main navigation views accessible from the sidebar:

#### 1. **Overview** (Home Dashboard)
- **Stats Grid**: Total spent, transaction count, average transaction, top category
- **Spending Chart**: Visual breakdown of spending by category
- **Recent Alerts**: Top 3 anomaly alerts (if any)
- **Forecasts**: AI-generated budget predictions

#### 2. **Transactions**
- Complete transaction history table
- Sortable columns: Description, Category, Date, Amount
- Refresh button for manual updates
- Stats grid showing transaction metrics

#### 3. **Forecasts**
- AI-powered budget predictions
- Category-based spending trends
- 30-day estimates with confidence intervals
- Generate new forecasts on-demand
- Actionable recommendations

#### 4. **Alerts**
- Anomaly detection alerts
- Severity levels: Low, Medium, High, Critical
- Detailed explanations and recommendations
- Dismiss alerts when acknowledged

### Core Features

#### 💬 Chat Interface
- Fixed bottom bar (Cursor-style)
- Ask questions about your budget
- Streaming AI responses
- Real-time answers

#### 📸 Receipt Upload
- Click "Upload Receipt" button in chat bar
- Automatic OCR processing
- Transaction extraction
- Auto-categorization

#### 🔔 Real-time Updates
- WebSocket connection for live data
- New transactions appear instantly
- Alert notifications in real-time
- No page refresh needed

## 🎨 Design System

### Color Palette

- **Primary (Blue)**: `#2563eb` - Actions, links, focus states
- **Success (Green)**: `#16a34a` - Success states
- **Warning (Amber)**: `#f59e0b` - Low/medium alerts
- **Danger (Red)**: `#dc2626` - High/critical alerts
- **Purple**: `#9333ea` - Analytics, forecasts
- **Gray Scale**: Full spectrum for text and backgrounds

### Typography

- **Headings**: Cinzel (serif) for logo, system-ui for content
- **Body**: system-ui, -apple-system, Segoe UI, Roboto
- **Numbers**: Tabular figures for alignment
- **Text Balance**: Optimized line wrapping for headings
- **Text Pretty**: Better word breaking for paragraphs

### Components

All components follow these patterns:

- **Cards**: `rounded-xl border border-gray-200 bg-white shadow-sm p-*`
- **Buttons**: Primary (blue), Secondary (white+border), Text (link-style)
- **Icons**: 24x24 outline icons from Heroicons
- **Spacing**: 8px base unit (Tailwind's default)
- **Shadows**: Subtle `shadow-sm` throughout

## 📐 Layout Structure

```
┌─────────────────────────────────────────┐
│ Header (Logo, Title, Metrics)          │
├──────────┬──────────────────────────────┤
│          │                              │
│ Sidebar  │  Main Content Area          │
│ (Nav)    │  - Stats Grid               │
│          │  - Charts                    │
│          │  - Tables                    │
│          │  - Cards                     │
│          │                              │
│          │                              │
├──────────┴──────────────────────────────┤
│ Chat Bar (Input + Upload)              │
└─────────────────────────────────────────┘
```

### Responsive Behavior

- **Desktop (≥1024px)**: Sidebar visible, multi-column layouts
- **Tablet (768-1023px)**: Collapsible sidebar, 2-column grids
- **Mobile (<768px)**: Hamburger menu, single column, stacked cards

## 🔧 Key Files

### Components
- `App.tsx` - Main application logic and view routing
- `Sidebar.tsx` - Navigation with mobile menu
- `Header.tsx` - Top app bar
- `ChatBar.tsx` - Bottom chat interface
- `StatsGrid.tsx` - 4-column stats dashboard
- `SpendingChart.tsx` - Category visualization
- `TransactionsTable.tsx` - Transaction list
- `AlertsSection.tsx` - Anomaly alerts
- `ForecastsSection.tsx` - Budget predictions

### Utilities
- `lib/utils.ts` - Helper functions (cn, formatCurrency)

### Styles
- `index.css` - Global styles + Tailwind directives
- `tailwind.config.js` - Tailwind configuration

## 🎯 User Flows

### Upload a Receipt
1. Click "Upload Receipt" in bottom chat bar
2. Select image from device
3. Wait for OCR processing
4. Transaction appears in table automatically
5. Check for any anomaly alerts

### Ask About Budget
1. Type question in chat input (e.g., "What's my biggest expense?")
2. Press Enter or click send button
3. See streaming response appear above main content
4. Dismiss response when done reading

### Generate Forecast
1. Navigate to "Forecasts" view (or use Overview)
2. Click "Generate Forecast" button
3. Wait for AI processing
4. Review predictions and recommendations
5. Use insights to plan budget

### Acknowledge Alert
1. View alert in Alerts section
2. Read explanation and recommendation
3. Click "Dismiss" button
4. Alert removed from active list

## 📊 Data Updates

### Automatic (WebSocket)
- New transactions
- New alerts
- Real-time metrics

### Manual (Button Click)
- Refresh transactions
- Generate forecasts
- Acknowledge alerts

## 🔍 Empty States

Every section has helpful empty states:

- **No Transactions**: "Upload a receipt to add one"
- **No Forecasts**: "Generate your first budget prediction"
- **No Alerts**: "All clear! No anomalies detected"
- **No Data**: Relevant icon + next action button

## ⚡ Performance

- **Bundle Size**: 238 KB JS (73 KB gzipped)
- **CSS**: 19 KB (4.4 KB gzipped)
- **First Load**: ~500ms on fast connection
- **HMR**: Instant updates during development
- **Real-time**: <100ms WebSocket latency

## 🐛 Troubleshooting

### Dev Server Won't Start
```bash
# Kill existing processes
lsof -ti:5174 | xargs kill -9

# Clear cache and restart
rm -rf node_modules/.vite
npm run dev
```

### Build Fails
```bash
# Remove old compiled files
find src -name "*.js" -o -name "*.js.map" | xargs rm -f

# Rebuild
npm run build
```

### TypeScript Errors
```bash
# Check for type errors
npx tsc --noEmit
```

### Missing Dependencies
```bash
# Reinstall all packages
rm -rf node_modules package-lock.json
npm install
```

## 📱 Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile Safari iOS 14+
- Chrome Android 90+

## 🔐 Security Notes

- All API calls include `X-User-Id` header
- No sensitive data in localStorage
- WebSocket uses same-origin policy
- Receipt images base64 encoded

## 📞 Need Help?

- Check `UI-IMPROVEMENTS.md` for detailed technical docs
- Review component files for inline documentation
- Test in development mode with React DevTools
- Enable verbose logging: `localStorage.debug = '*'`

---

**Happy Budgeting! 💰**
