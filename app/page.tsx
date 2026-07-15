import { ProductionWorkspace } from "@/components/ProductionWorkspace";
import { listProductionWorkspaceData } from "@/app/actions/produccion";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const supabase = await createClient();
  const [{ data: { user } }, data] = await Promise.all([
    supabase.auth.getUser(),
    listProductionWorkspaceData(),
  ]);

  return (
    <div className="production-app">
      <ProductionWorkspace data={data} email={user?.email ?? "produccion@tecondor.com"} />
    </div>
  );
}
