import { createFileRoute, Link } from "@tanstack/react-router";
import {
  Shield,
  ClipboardCheck,
  Truck,
  AlertTriangle,
  GraduationCap,
  FileCheck,
  Users,
  ArrowRight,
  CheckCircle2,
  Activity,
} from "lucide-react";
import { ThemeToggle } from "../components/theme-provider";
import { PageBackground } from "../components/page-background";

export const Route = createFileRoute("/")({ component: LandingPage });

const FEATURES = [
  {
    icon: ClipboardCheck,
    title: "Health Check-Up",
    desc: "Daily fitness-for-duty declarations with clear fit / restricted / unfit confirmation.",
  },
  {
    icon: Truck,
    title: "Journey & Fleet",
    desc: "Plan journeys, vehicle inspections, parking logs, and live fatigue monitoring.",
  },
  {
    icon: FileCheck,
    title: "Permit To Work",
    desc: "Strict workflow: request → review → approve → activate → close. No shortcuts.",
  },
  {
    icon: AlertTriangle,
    title: "Incident & CAPA",
    desc: "Report, investigate, and track corrective actions through to completion.",
  },
  {
    icon: GraduationCap,
    title: "Training Matrix",
    desc: "Colour-coded competence matrix with days-remaining countdown and export.",
  },
  {
    icon: FileCheck,
    title: "Finance and Books",
    desc: "Requests from site, two-step approval, invoices with VAT, trial balance and printable statements.",
  },
  {
    icon: Activity,
    title: "Live Dashboards",
    desc: "Role-specific KPIs, trends, and activity feeds — always scoped to what you can see.",
  },
];

const ROLES = [
  { name: "Administrator", desc: "Full system control, users & settings" },
  { name: "EHS Officer", desc: "Day-to-day compliance & investigations" },
  { name: "Manager", desc: "Approvals, journeys & department oversight" },
  { name: "Driver", desc: "Health, inspections, journeys & parking" },
  { name: "Employee", desc: "Health declarations, notices & reporting" },
];

function LandingPage() {
  return (
    <div className="min-h-screen bg-bg text-fg">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b border-border bg-bg/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg bg-accent text-accent-fg shadow-sm">
              <Shield className="size-4" strokeWidth={2.2} />
            </span>
            <div>
              <p className="text-sm font-semibold tracking-tight">Smart Hub</p>
              <p className="text-[11px] leading-none text-fg-subtle">
                Operations · Finance · Safety
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-3">
            <ThemeToggle />
            <Link
              to="/login"
              className="inline-flex h-10 items-center rounded-lg bg-accent px-4 text-sm font-semibold text-accent-fg transition-colors hover:bg-accent-bright"
            >
              Sign in
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <PageBackground />

        <div className="relative z-10 mx-auto max-w-6xl px-4 pb-20 pt-16 sm:px-6 sm:pt-24">
          <div className="max-w-2xl rounded-2xl border border-border bg-bg/80 p-6 shadow-lg backdrop-blur-md sm:p-8">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-bg-elevated px-3 py-1.5 text-xs font-medium text-fg-muted">
              <span className="size-1.5 rounded-full bg-ok" />
              Operations, money and safety in one system
            </div>

            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl lg:text-[3.25rem] lg:leading-[1.15]">
              One system for your{" "}
              <span className="text-accent-bright">company's daily work</span>
            </h1>

            <p className="mt-5 max-w-xl text-base leading-relaxed text-fg-muted sm:text-lg">
              Requests, approvals, projects, attendance, budgets, books and safety records in one place, with the right access for every role.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/login"
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-accent px-6 text-sm font-semibold text-accent-fg shadow-lg shadow-accent/25 transition-all hover:bg-accent-bright hover:shadow-accent/40 active:scale-[0.98]"
              >
                Sign in to workspace
                <ArrowRight className="size-4" />
              </Link>
              <a
                href="#features"
                className="inline-flex h-12 items-center rounded-xl border border-border-strong px-6 text-sm font-medium transition-colors hover:bg-bg-subtle"
              >
                Explore features
              </a>
            </div>

            <div className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm text-fg-subtle">
              {["Role-based access", "Audit trail", "Mobile ready", "Enforced workflows"].map(
                (item) => (
                  <span key={item} className="inline-flex items-center gap-1.5">
                    <CheckCircle2 className="size-3.5 text-ok" />
                    {item}
                  </span>
                ),
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="relative z-10 border-t border-border bg-bg/80 backdrop-blur-sm">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mb-12 max-w-xl">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Everything your company needs day to day
            </h2>
            <p className="mt-3 text-fg-muted">
              From site requests and budgets to invoices, leave, daily reports, permits to work and incident investigation.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group rounded-2xl border border-border bg-bg-elevated p-6 transition-all duration-200 hover:border-accent/40 hover:shadow-lg hover:shadow-accent/5"
              >
                <div className="mb-4 grid size-11 place-items-center rounded-xl bg-accent/15 text-accent-bright transition-colors group-hover:bg-accent group-hover:text-accent-fg">
                  <f.icon className="size-5" strokeWidth={1.8} />
                </div>
                <h3 className="text-base font-semibold tracking-tight">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-fg-muted">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Roles */}
      <section className="relative z-10 border-t border-border bg-bg/80 backdrop-blur-sm">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Built for every role
              </h2>
              <p className="mt-2 text-fg-muted">
                Each user only sees the modules and data relevant to their responsibility.
              </p>
            </div>
            <div className="flex items-center gap-2 text-sm text-fg-subtle">
              <Users className="size-4" />
              Access follows each person's role
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {ROLES.map((r) => (
              <div
                key={r.name}
                className="rounded-xl border border-border bg-bg-elevated p-4 transition-colors hover:border-accent/30"
              >
                <p className="text-sm font-semibold">{r.name}</p>
                <p className="mt-1 text-xs leading-relaxed text-fg-muted">{r.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-10 border-t border-border bg-bg/85 backdrop-blur-sm">
        <div className="mx-auto max-w-6xl px-4 py-16 text-center sm:px-6 sm:py-20">
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Ready to run your operations in one place?
          </h2>
          <p className="mx-auto mt-3 max-w-md text-fg-muted">
            Sign in with the account your company administrator created for you.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/login"
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-accent px-7 text-sm font-semibold text-accent-fg shadow-lg shadow-accent/25 transition-all hover:bg-accent-bright active:scale-[0.98]"
            >
              Go to Sign In
              <ArrowRight className="size-4" />
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-border bg-bg/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 py-8 text-center text-xs text-fg-subtle sm:flex-row sm:px-6 sm:text-left">
          <p>© {new Date().getFullYear()} Smart Hub</p>
          <span>Secure, role-based access for your team</span>
        </div>
      </footer>
    </div>
  );
}
