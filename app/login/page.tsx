"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <main className="login-page">
      <section className="login-panel">
        <div className="login-brand">
          <Image src="/logo.png" alt="TECONDOR" width={78} height={101} priority />
          <div>
            <span>TECONDOR</span>
            <h1>Produccion</h1>
            <p>Tablero de planta, tareas e inventario</p>
          </div>
        </div>
        <form
          className="login-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setError(null);
            setLoading(true);
            const { error: authError } = await createClient().auth.signInWithPassword({ email, password });
            setLoading(false);
            if (authError) {
              setError("No pudimos iniciar sesion. Revisa el correo y la contrasena.");
              return;
            }
            router.replace("/");
            router.refresh();
          }}
        >
          <label>
            <span>Correo</span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
          </label>
          <label>
            <span>Contrasena</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
          </label>
          {error ? <div className="login-error">{error}</div> : null}
          <button type="submit" disabled={loading}>{loading ? "Ingresando..." : "Entrar a planta"}</button>
        </form>
      </section>
    </main>
  );
}
