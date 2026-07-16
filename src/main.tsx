import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { Toaster } from "./components/Toaster";
import { createQueryClient } from "./lib/queryClient";
import { loadTheme } from "./lib/persist";
import { applyTheme } from "./lib/theme";

// Apply the persisted theme before first paint so a manual choice doesn't flash the system theme.
applyTheme(loadTheme());

const queryClient = createQueryClient();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
      <Toaster />
    </QueryClientProvider>
  </React.StrictMode>,
);
