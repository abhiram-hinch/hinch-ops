import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { fetchSalesOrder, fetchSalesOrderPdf } from "./zoho.ts";
import { upsertSalesOrder, recordSyncRun } from "./upsert.ts";

export interface SyncResult {
  id: string;
  zohoId: string;
  matchedOn: string;
  pdf: boolean;
}

/**
 * The single code path that brings one Zoho sales order fully up to date:
 *   full single-order payload -> upsert (detail + line items)
 *   -> sales-order PDF into the private so-pdfs bucket.
 *
 * Used by zoho-so-webhook (real time) and zoho-so-detail (on panel open).
 * A PDF failure is logged, never fatal.
 */
export async function syncOneOrder(
  db: SupabaseClient,
  zohoId: string,
  source: "webhook" | "poll" | "manual",
  opts: { withPdf?: boolean } = {},
): Promise<SyncResult> {
  const started = Date.now();

  const so = await fetchSalesOrder(zohoId);
  const { id, matchedOn } = await upsertSalesOrder(db, so);

  let pdf = false;
  if (opts.withPdf !== false) {
    try {
      const bytes = await fetchSalesOrderPdf(zohoId);
      const path = `${zohoId}.pdf`;
      const { error } = await db.storage
        .from("so-pdfs")
        .upload(path, bytes, { contentType: "application/pdf", upsert: true });
      if (error) throw error;
      await db.from("sales_orders").update({ so_pdf_path: path }).eq("id", id);
      pdf = true;
    } catch (e) {
      console.error(`syncOne: PDF failed for ${zohoId}: ${e instanceof Error ? e.message : e}`);
    }
  }

  await recordSyncRun(db, source, { records_seen: 1, records_upsert: 1 });
  console.log(
    `syncOne src=${source} zoho=${zohoId} row=${id} approval_via=${matchedOn} pdf=${pdf} ms=${Date.now() - started}`,
  );
  return { id, zohoId, matchedOn, pdf };
}
