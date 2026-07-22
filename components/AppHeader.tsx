"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { PwaRegistration } from "@/components/PwaRegistration";

type AppSection = "tareas" | "inventario" | "consumos";

const navigation: Array<{ id: AppSection; label: string }> = [
  { id: "tareas", label: "Tareas" },
  { id: "inventario", label: "Inventario" },
  { id: "consumos", label: "Consumos" },
];

export function AppHeader({
  email,
  activeOperatorName,
  activeSection,
  primaryActionLabel,
  notificationCount,
  onSectionChange,
  onPrimaryAction,
  onNotificationsClick,
  onChangeOperator,
}: {
  email: string;
  activeOperatorName: string;
  activeSection: AppSection;
  primaryActionLabel: string;
  notificationCount: number;
  onSectionChange: (section: AppSection) => void;
  onPrimaryAction: () => void;
  onNotificationsClick: () => void;
  onChangeOperator: () => void;
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
          <button type="button" className="operator-button" onClick={onChangeOperator} title={`Registrando como ${activeOperatorName}`}>
            <span>{operatorInitials(activeOperatorName)}</span>
            <b><small>Registrando como</small>{activeOperatorName}</b>
          </button>
          <PwaRegistration />
          <div className="notification-center">
            <button
              type="button"
              className={notificationCount ? "notification-button has-alerts" : "notification-button"}
              aria-label={notificationCount ? `${notificationCount} tareas terminadas` : "Activar notificaciones de tareas"}
              onClick={async () => {
                if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
                onNotificationsClick();
              }}
            >
              <span aria-hidden="true">Avisos</span>
              {notificationCount ? <b>{notificationCount}</b> : null}
            </button>
          </div>
          <button type="button" className="header-primary-action" onClick={onPrimaryAction}>
            <span>+</span>{primaryActionLabel}
          </button>
          <button
            type="button"
            className="user-button"
            title={email}
            onClick={async () => {
              const shouldSignOut = window.confirm("¿Seguro que quieres cerrar sesión?");
              if (!shouldSignOut) return;
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

function operatorInitials(value: string): string {
  const words = String(value || "").trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word.charAt(0).toUpperCase()).join("") || "?";
}
