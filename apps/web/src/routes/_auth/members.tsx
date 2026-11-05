import { Outlet, createFileRoute } from "@tanstack/react-router";

/**
 * Layout route: /members is the list (members.index), /members/$id the detail.
 * Both render through this Outlet.
 */
export const Route = createFileRoute("/_auth/members")({
  component: () => <Outlet />,
});
