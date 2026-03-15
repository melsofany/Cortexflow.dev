import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Dashboard from "./pages/dashboard";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5000,
    },
  },
});

function NotFound() {
  return (
    <div className="h-screen w-screen flex flex-col items-center justify-center bg-background border-[10px] border-destructive/20 relative overflow-hidden">
      <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=1920&q=80')] opacity-5 bg-cover bg-center mix-blend-screen" />
      <h1 className="text-[120px] font-display font-bold text-destructive neon-text mb-4 z-10 leading-none">
        404
      </h1>
      <p className="text-xl font-mono text-muted-foreground z-10 uppercase tracking-widest">
        Sector Not Found
      </p>
      <a href="/" className="mt-8 px-8 py-3 bg-white/5 border border-white/20 text-white font-bold tracking-widest uppercase rounded-lg hover:bg-white/10 hover:border-white/40 transition-all z-10">
        Return to Dashboard
      </a>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Switch>
          <Route path="/" component={Dashboard} />
          <Route component={NotFound} />
        </Switch>
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
