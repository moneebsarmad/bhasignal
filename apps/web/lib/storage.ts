import { SheetsAdapter, SupabaseAdapter } from "@syc/storage";

import { createGoogleSheetsClient } from "@/lib/google-sheets-client";
import { LocalStorageAdapter, type AppStorageAdapter } from "@/lib/local-storage-adapter";
import { createSupabaseServerClient } from "@/lib/supabase-server-client";

let localAdapterSingleton: LocalStorageAdapter | null = null;
let sheetsAdapterSingleton: SheetsAdapter | null = null;
let supabaseAdapterSingleton: SupabaseAdapter | null = null;

function hasSupabaseEnv(): boolean {
  return Boolean(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

function hasSheetsEnv(): boolean {
  return Boolean(
    process.env.GOOGLE_SHEETS_SPREADSHEET_ID &&
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY
  );
}

export function createStorageAdapter(): AppStorageAdapter {
  if (hasSupabaseEnv()) {
    if (!supabaseAdapterSingleton) {
      supabaseAdapterSingleton = new SupabaseAdapter(createSupabaseServerClient());
    }
    return supabaseAdapterSingleton;
  }

  if (hasSheetsEnv()) {
    if (!sheetsAdapterSingleton) {
      sheetsAdapterSingleton = new SheetsAdapter(createGoogleSheetsClient());
    }
    return sheetsAdapterSingleton;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Supabase or Google Sheets credentials are required in production. Local file storage fallback is development-only."
    );
  }

  if (!localAdapterSingleton) {
    localAdapterSingleton = new LocalStorageAdapter();
  }
  return localAdapterSingleton;
}
