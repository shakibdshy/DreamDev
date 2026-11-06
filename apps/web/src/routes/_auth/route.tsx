import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import { AppShell } from "@/components/app-shell";
import { getUser } from "@/functions/get-user";

export const Route = createFileRoute("/_auth")({
  component: AuthLayout,
  beforeLoad: async () => {
    const session = await getUser();
    if (!session) {
      throw redirect({
        to: "/login",
      });
    }
    return { session };
  },
  loader: async ({ context }) => {
    if (!context.session) {
      throw redirect({
        to: "/login",
      });
    }
  },
});

function AuthLayout() {
  const { session } = Route.useRouteContext();
  if (!session) return null;
  return (
    <AppShell user={session.user}>
      <Outlet />
    </AppShell>
  );
}
