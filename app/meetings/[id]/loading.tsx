import { Brand } from "@/components/Brand";

export default function Loading() {
  return (
    <div className="bg-dot flex min-h-screen flex-col">
      <div className="h-1 w-full bg-gradient-to-r from-gold to-navy" />

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-6 sm:gap-5 sm:px-5 sm:py-8">
        <Brand subtitle="Host view" />

        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-2">
            <div className="h-8 w-56 animate-pulse rounded-lg bg-line/70" />
            <div className="h-4 w-40 animate-pulse rounded bg-line/50" />
          </div>
          <div className="h-12 w-full animate-pulse rounded-xl bg-line/60 sm:w-48" />
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
          <section className="card flex flex-col gap-4 p-5">
            <div className="mx-auto h-56 w-56 animate-pulse rounded-xl bg-line/50 sm:h-64 sm:w-64" />
            <div className="h-12 w-full animate-pulse rounded-xl bg-line/60" />
            <div className="h-16 w-full animate-pulse rounded-xl bg-line/40" />
          </section>

          <section className="card flex h-full min-h-[16rem] flex-col items-center justify-center gap-2 p-5">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-gold" />
            <p className="text-sm font-medium text-slate-500">Loading the host view…</p>
          </section>
        </div>
      </main>
    </div>
  );
}
