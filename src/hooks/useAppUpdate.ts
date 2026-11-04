"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { APP_VERSION, fetchNewVersion } from "@/lib/appUpdate";

export function useAppUpdate(enabled: boolean) {
  const [newVersion, setNewVersion] = useState<string | null>(null);
  const pending = useRef<Promise<string | null> | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const checkForUpdate = useCallback((): Promise<string | null> => {
    if (pending.current) return pending.current;
    const request = fetchNewVersion(APP_VERSION)
      .then((version) => {
        if (mounted.current && version) setNewVersion(version);
        return version;
      })
      .finally(() => {
        pending.current = null;
      });
    pending.current = request;
    return request;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const check = () => {
      if (document.visibilityState === "visible") void checkForUpdate();
    };
    check();
    const interval = window.setInterval(check, 60_000);
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", check);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [enabled, checkForUpdate]);

  return { newVersion, checkForUpdate };
}
