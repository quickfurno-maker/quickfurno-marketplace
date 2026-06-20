import { SiteHeader } from "@/components/Brand";
import { LoginForm } from "@/components/LoginForm";

export const metadata = { title: "Sign in — QuickFurno" };

export default function LoginPage() {
  return (
    <>
      <SiteHeader />
      <section className="mx-auto max-w-6xl px-5 pt-16 pb-10 text-center">
        <p className="eyebrow">Studio &amp; admin access</p>
        <h1 className="mt-4 text-3xl font-semibold text-ivory">Welcome back</h1>
      </section>
      <section className="mx-auto max-w-6xl px-5 pb-20">
        <LoginForm />
      </section>
    </>
  );
}
