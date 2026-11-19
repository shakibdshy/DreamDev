import { useRouter } from "@tanstack/react-router";
import { ClockAlertIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { IDLE_CHANNEL, idlePhase, secondsLeft } from "@/lib/idle-logout";

/** Events that count as activity (throttled — pointermove alone would fire constantly). */
const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "scroll"] as const;
const ACTIVITY_THROTTLE_MS = 15_000;
const CHECK_MS = 10_000;

type IdleMessage = { type: "activity"; t: number } | { type: "signed-out" };

/**
 * Signs the session out after 15 minutes of inactivity, warning 90s ahead.
 * Multi-tab aware via BroadcastChannel: activity in any tab resets the timer
 * everywhere, and a logout in one tab lands every tab on /login. No timers or
 * state persist anywhere — the count restarts from zero on a fresh page load.
 */
export function IdleLogoutGuard() {
  const router = useRouter();
  const lastActivity = useRef(Date.now());
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const [signOutError, setSignOutError] = useState(false);
  const signingOut = useRef(false);
  const signOutFailed = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);

  const signOut = useCallback(() => {
    if (signingOut.current) return;
    signingOut.current = true;
    signOutFailed.current = false;
    setSignOutError(false);
    authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          // Other tabs should leave only after this tab's session is really gone.
          channel.current?.postMessage({ type: "signed-out" } satisfies IdleMessage);
          void router.navigate({ to: "/login", search: { reason: "idle" } });
        },
        onError: (context) => {
          signingOut.current = false;
          // Once failed, only the explicit Retry button may call signOut again —
          // the interval must not hammer the auth endpoint every CHECK_MS.
          signOutFailed.current = true;
          setSignOutError(true);
          console.error("Idle sign-out failed", context);
        },
      },
    });
  }, [router]);

  useEffect(() => {
    // Without BroadcastChannel this degrades to per-tab timers: each tab still
    // signs itself out, but activity no longer resets the others.
    channel.current = "BroadcastChannel" in window ? new BroadcastChannel(IDLE_CHANNEL) : null;
    const activeChannel = channel.current;

    let lastBroadcast = 0;
    let trailingBroadcast: number | undefined;
    const broadcastActivity = () => {
      lastBroadcast = Date.now();
      if (trailingBroadcast !== undefined) {
        window.clearTimeout(trailingBroadcast);
        trailingBroadcast = undefined;
      }
      activeChannel?.postMessage({ type: "activity", t: lastActivity.current } satisfies IdleMessage);
    };

    const onActivity = () => {
      const now = Date.now();
      // Every input counts, even inside the throttle window. Only delivery is throttled.
      lastActivity.current = now;
      const elapsed = lastBroadcast === 0 ? ACTIVITY_THROTTLE_MS : now - lastBroadcast;
      if (elapsed >= ACTIVITY_THROTTLE_MS) {
        broadcastActivity();
        return;
      }
      if (trailingBroadcast === undefined) {
        trailingBroadcast = window.setTimeout(() => {
          trailingBroadcast = undefined;
          broadcastActivity();
        }, ACTIVITY_THROTTLE_MS - elapsed);
      }
    };
    const listeners = ACTIVITY_EVENTS.map((event) => {
      window.addEventListener(event, onActivity, { passive: true });
      return [event, onActivity] as const;
    });

    activeChannel?.addEventListener("message", (event: MessageEvent<IdleMessage>) => {
      const message = event.data;
      if (message.type === "activity" && message.t > lastActivity.current) {
        lastActivity.current = message.t;
        return;
      }
      if (message.type === "signed-out" && !signingOut.current) {
        signingOut.current = true; // another tab already cleared the session — just leave
        void router.navigate({ to: "/login", search: { reason: "idle" } });
      }
    });

    const timer = window.setInterval(() => {
      if (signingOut.current || signOutFailed.current) return;
      const idleMs = Date.now() - lastActivity.current;
      const phase = idlePhase(idleMs);
      if (phase === "active") {
        setSecondsRemaining(null);
        return;
      }
      setSecondsRemaining(secondsLeft(idleMs));
      if (phase === "expired") {
        setSecondsRemaining(null);
        signOut();
      }
    }, CHECK_MS);

    return () => {
      window.clearInterval(timer);
      if (trailingBroadcast !== undefined) window.clearTimeout(trailingBroadcast);
      activeChannel?.close();
      if (channel.current === activeChannel) channel.current = null;
      for (const [event, handler] of listeners) window.removeEventListener(event, handler);
    };
  }, [router, signOut]);

  const alertClass =
    "fixed inset-x-0 bottom-4 z-50 mx-auto flex w-fit items-center gap-2 rounded-full border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive shadow-lg backdrop-blur";

  if (signOutError) {
    return (
      <div role="alert" className={alertClass}>
        <ClockAlertIcon className="size-4 shrink-0" aria-hidden />
        Couldn&apos;t sign out after inactivity.
        <button type="button" className="font-semibold underline" onClick={signOut}>
          Retry
        </button>
      </div>
    );
  }
  if (secondsRemaining === null) return null;
  return (
    <div role="alert" className={alertClass}>
      <ClockAlertIcon className="size-4 shrink-0" aria-hidden />
      Signing out in {secondsRemaining}s — click, scroll or type to stay signed in.
    </div>
  );
}
