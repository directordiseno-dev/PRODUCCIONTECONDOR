"use client";

import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function PwaRegistration() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    let updateTimer: number | undefined;
    let registration: ServiceWorkerRegistration | undefined;

    const checkAppVersion = async () => {
      try {
        const response = await fetch("/api/version", { cache: "no-store" });
        if (!response.ok) return;
        const { version } = await response.json() as { version?: string };
        if (!version || version === "local") return;

        const storedVersion = window.localStorage.getItem("tecondor-app-version");
        window.localStorage.setItem("tecondor-app-version", version);
        if (storedVersion && storedVersion !== version) window.location.reload();
      } catch {
        // La app puede seguir operando con normalidad cuando no hay conexion.
      }
    };

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { updateViaCache: "none" })
        .then(async (currentRegistration) => {
          registration = currentRegistration;
          await currentRegistration.update();
        })
        .catch(() => undefined);
    }

    void checkAppVersion();
    updateTimer = window.setInterval(() => {
      void checkAppVersion();
      void registration?.update();
    }, 5 * 60 * 1000);

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      void checkAppVersion();
      void registration?.update();
    };

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPrompt(null);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      if (updateTimer) window.clearInterval(updateTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!prompt || installed) return null;

  return (
    <button
      type="button"
      className="install-button"
      onClick={async () => {
        await prompt.prompt();
        const choice = await prompt.userChoice;
        if (choice.outcome === "accepted") setPrompt(null);
      }}
    >
      <span aria-hidden="true">+</span>
      Instalar app
    </button>
  );
}
