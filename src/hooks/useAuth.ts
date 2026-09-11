import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { qk } from "@/lib/queryKeys";
import type { Profile } from "@/types/database";

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      // Every cached query is scoped to the signed-in user (their profile, and
      // the rows RLS lets them read). Drop all of it on sign-out so the next
      // user in this tab never sees the previous user's data.
      if (event === "SIGNED_OUT") queryClient.clear();
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, [queryClient]);

  return { session, loading };
}

export function useProfile(userId: string | undefined) {
  return useQuery({
    queryKey: qk.profile(userId ?? ""),
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
