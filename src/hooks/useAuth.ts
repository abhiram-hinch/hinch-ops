import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { qk } from "@/lib/queryKeys";
import type { Profile } from "@/types/database";

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  return { session, loading };
}

export function useProfile(userId: string | undefined) {
  return useQuery({
    queryKey: qk.profile,
    enabled: !!userId,
    queryFn: async (): Promise<Profile | null> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, role, active")
        .eq("id", userId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export const canEditPayments = (role?: string) =>
  role === "sales" || role === "accounts" || role === "admin";

/** Only accounts / admin may confirm (clear) or bounce a recorded payment. */
export const canClearPayments = (role?: string) =>
  role === "accounts" || role === "admin";

/** Sales tags credit customers at order time; accounts/admin can too. */
export const canTagCreditRegular = (role?: string) =>
  role === "sales" || role === "accounts" || role === "admin";

/** Placing or lifting a credit hold is accounts / admin only. */
export const canSetCreditHold = (role?: string) =>
  role === "accounts" || role === "admin";

/**
 * The payments tab is hidden from sales / warehouse for a credit customer —
 * they don't collect payment upfront. Accounts / admin still manage it.
 */
export const canSeePaymentsFor = (role: string | undefined, isCreditCustomer: boolean) =>
  !isCreditCustomer || role === "accounts" || role === "admin";

export const canEditDispatch = (role?: string) =>
  role === "ops" || role === "warehouse" || role === "admin";

/**
 * Authorising procurement ahead of payment commits working capital to stock
 * for a customer with no credit standing. Sales hear the request, accounts
 * carry the exposure. Deliberately not warehouse — they move stock, they
 * don't commit money. Mirrors can_authorize_procure_first() in Postgres.
 */
export const canAuthorizeProcureFirst = (role?: string) =>
  role === "sales" || role === "accounts" || role === "admin";
