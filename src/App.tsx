import { useSession, useProfile } from "@/hooks/useAuth";
import { LoginPage } from "@/features/auth/LoginPage";
import { OpsBoard } from "@/features/board/OpsBoard";

export default function App() {
  const { session, loading } = useSession();
  const { data: profile, isLoading: profileLoading } = useProfile(session?.user.id);

  if (loading) return <Splash text="Loading…" />;
  if (!session) return <LoginPage />;
  if (profileLoading) return <Splash text="Loading your profile…" />;

  if (!profile) {
    return (
      <Splash text="Your account isn't set up yet. Ask an admin to add you with a role." />
    );
  }
  if (!profile.active) return <Splash text="This account has been deactivated." />;

  return <OpsBoard profile={profile} />;
}

function Splash({ text }: { text: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-8">
      <div className="text-center">
        <p className="text-lg font-bold tracking-tight">
          HINCH <span className="text-brand">Ops</span>
        </p>
        <p className="mt-2 max-w-sm text-sm text-muted">{text}</p>
      </div>
    </div>
  );
}
