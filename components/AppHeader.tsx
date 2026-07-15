"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PwaRegistration } from "@/components/PwaRegistration";

type AppSection = "inicio" | "inventario" | "tareas" | "consumos";

const navigation: Array<{ id: AppSection; label: string }> = [
  { id: "inicio", label: "Inicio" },
  { id: "inventario", label: "Inventario" },
  { id: "tareas", label: "Tareas" },
  { id: "consumos", label: "Consumos" },
];

export function AppHeader({
  email,
  activeSection,
  primaryActionLabel,
  onSectionChange,
  onPrimaryAction,
}: {
  email: string;
  activeSection: AppSection;
  primaryActionLabel: string;
  onSectionChange: (section: AppSection) => void;
  onPrimaryAction: () => void;
}) {
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
        <nav className="plant-nav" aria-label="Secciones de produccion">
          {navigation.map((item) => (
            <button
              key={item.id}
              type="button"
              className={activeSection === item.id ? "is-active" : undefined}
              aria-current={activeSection === item.id ? "page" : undefined}
              onClick={() => onSectionChange(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="plant-header__actions">
          <PwaRegistration />
          <button type="button" className="header-primary-action" onClick={onPrimaryAction}>
            <span>+</span>{primaryActionLabel}
          </button>
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
