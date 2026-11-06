import { Avatar, AvatarFallback } from "@DreamDev/ui/components/avatar";
import { Badge } from "@DreamDev/ui/components/badge";
import { Button } from "@DreamDev/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@DreamDev/ui/components/dropdown-menu";
import { Skeleton } from "@DreamDev/ui/components/skeleton";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, LogOutIcon } from "lucide-react";

import { authClient } from "@/lib/auth-client";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("");
}

export default function UserMenu({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();

  if (isPending) return <Skeleton className="h-9 w-28" />;

  if (!session) {
    return (
      <Link to="/login">
        <Button variant="outline" size="sm">
          Sign in
        </Button>
      </Link>
    );
  }

  const { user } = session;
  const role = (user as { role?: string }).role ?? "member";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size={compact ? "icon" : "default"} className="gap-2 px-1.5" aria-label="Account menu">
            <Avatar className="size-7">
              <AvatarFallback>{initials(user.name)}</AvatarFallback>
            </Avatar>
            {!compact && (
              <span className="hidden max-w-32 truncate text-sm font-medium md:block">{user.name}</span>
            )}
            {!compact && <ChevronDownIcon className="size-3.5 text-muted-foreground" />}
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col gap-1 py-2">
            <span className="text-sm font-medium text-foreground">{user.name}</span>
            <span className="truncate text-xs text-muted-foreground">{user.email}</span>
          </DropdownMenuLabel>
          <div className="px-2 pb-2">
            <Badge variant={role === "admin" ? "default" : "secondary"} className="capitalize">
              {role}
            </Badge>
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              authClient.signOut({
                fetchOptions: {
                  onSuccess: () => {
                    navigate({ to: "/login" });
                  },
                },
              });
            }}
          >
            <LogOutIcon />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
