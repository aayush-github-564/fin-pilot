import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";

import { AppRoutes } from "./app/app";
import { AuthProvider } from "./app/auth-context";
import { queryClient } from "./app/query-client";
import "./index.css";

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("The application root element is missing.");

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
