"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PwaRegistration } from "@/components/PwaRegistration";

export function AppHeader({ email }: { email: string }) {
  const router = useRouter();
  return (
    <header className="plant-header">
      <div className="plant-header__inner">
        <div className="plant-brand">
          <Image src="/logo.png" alt="TECONDOR" width={34} height={44} priority />
          <div>
            <div className="plant-brand__name">Produccion</div>
            <div className="plant-brand__status"><span /> Planta conectada</div>
          </div>
        </div>
        <div className="plant-header__actions">
          <PwaRegistration />
          <button
            type="button"
            className="user-button"
            title={email}
            onClick={async () => {
              await createClient().auth.signOut();
              router.replace("/login");
              router.refresh();
            }}
          >
            <span>{email.slice(0, 1).toUpperCase()}</span>
            <b>Salir</b>
          </button>
        </div>
      </div>
    </header>
  );
}
