import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: tasks, error } = await supabase
    .from("production_tasks")
    .select("*")
    .order("created_at", { ascending: false });

  return NextResponse.json({ tasks, error });
}
