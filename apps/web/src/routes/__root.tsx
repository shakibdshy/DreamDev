import { Toaster } from "@DreamDev/ui/components/sonner";
import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from "@tanstack/react-router";
import { TanStackRouterDevtools } from "@tanstack/react-router-devtools";
import { createMiddleware } from "@tanstack/react-start";
import { evlogErrorHandler } from "evlog/nitro/v3";

import { ThemeProvider } from "../components/theme-provider";

import appCss from "../index.css?url";

export interface RouterAppContext {}

export const Route = createRootRouteWithContext<RouterAppContext>()({
  server: {
    middleware: [createMiddleware().server(evlogErrorHandler)],
  },

  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "DreamDev — Team Fund" },
      {
        name: "description",
        content: "The team's savings fund: monthly shares, contributions, dues, and interest-free loans in one ledger.",
      },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),

  component: RootDocument,
});

function RootDocument() {
  return (
    <html lang="en-GB" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider>
          <Outlet />
          <Toaster position="bottom-right" />
        </ThemeProvider>
        {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-left" />}
        <Scripts />
      </body>
    </html>
  );
}
