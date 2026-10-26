import { createRoot } from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { QueryClientProvider } from '@tanstack/react-query';
import { wagmiAdapter, queryClient } from './config/walletConnect';
import { ThemeProvider } from './context/ThemeContext';
import { CurrencyProvider } from './context/CurrencyContext';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <WagmiProvider config={wagmiAdapter.wagmiConfig}>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <CurrencyProvider>
          {document.documentElement.dataset.storagePersistent === 'false' && <div role="status" className="bg-amber-100 text-amber-950 p-3 text-sm">Browser storage is unavailable. Wallet sessions, preferences and local history will be lost when this page closes. On-chain funds and shared payment links are unaffected.</div>}
          <App />
        </CurrencyProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </WagmiProvider>
);
