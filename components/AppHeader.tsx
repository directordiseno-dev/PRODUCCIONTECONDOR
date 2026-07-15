"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { PwaRegistration } from "@/components/PwaRegistration";

type AppSection = "tareas" | "inventario" | "consumos";

const navigation: Array<{ id: AppSection; label: string }> = [
  { id: "tareas", label: "Tareas" },
  { id: "inventario", label: "Inventario" },
  { id: "consumos", label: "Consumos" },
];

export type AppNotification = { id: string; title: string; detail: string };

export function AppHeader({
  email,
  activeSection,
  primaryActionLabel,
  notifications,
  onSectionChange,
  onPrimaryAction,
  onOpenNotification,
}: {
  email: string;
  activeSection: AppSection;
  primaryActionLabel: string;
  notifications: AppNotification[];
  onSectionChange: (section: AppSection) => void;
  onPrimaryAction: () => void;
  onOpenNotification: (id: string) => void;
}) {
  const router = useRouter();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
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
              onClick={() => { setNotificationsOpen(false); onSectionChange(item.id); }}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <div className="plant-header__actions">
          <PwaRegistration />
          <div className="notification-center">
            <button
              type="button"
              className={notifications.length ? "notification-button has-alerts" : "notification-button"}
              aria-label={notifications.length ? `${notifications.length} tareas terminadas` : "Notificaciones de tareas"}
              aria-expanded={notificationsOpen}
              onClick={async () => {
                setNotificationsOpen((current) => !current);
                if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
              }}
            >
              <span aria-hidden="true">Avisos</span>
              {notifications.length ? <b>{notifications.length}</b> : null}
            </button>
            {notificationsOpen ? (
              <div className="notification-popover" role="dialog" aria-label="Tareas terminadas">
                <div className="notification-popover__header">
                  <strong>Tareas terminadas</strong>
                  <small>{notifications.length ? "Pendientes de revisar" : "Sin novedades"}</small>
                </div>
                <div className="notification-popover__list">
                  {notifications.length ? notifications.map((notification) => (
                    <button
                      key={notification.id}
                      type="button"
                      onClick={() => { setNotificationsOpen(false); onOpenNotification(notification.id); }}
                    >
                      <strong>{notification.title}</strong>
                      <span>{notification.detail}</span>
                    </button>
                  )) : <p>Cuando un operario termine una tarea que creaste, aparecera aqui.</p>}
                </div>
              </div>
            ) : null}
          </div>
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
