export default function LoadingPage() {
  return (
    <div className="min-h-screen bg-[var(--color-canvas)] p-4 sm:p-6 lg:p-8">
      <div className="mx-auto flex min-h-[calc(100vh-2rem)] max-w-shell gap-5">
        <div className="hidden w-80 rounded-[2rem] border border-white/70 bg-white/70 p-5 shadow-card lg:block" />
        <div className="flex flex-1 flex-col gap-5">
          <div className="h-28 rounded-[1.75rem] border border-white/70 bg-white/80 shadow-card" />
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="h-48 rounded-[1.75rem] border border-white/70 bg-white/80 shadow-card lg:col-span-2" />
            <div className="h-48 rounded-[1.75rem] border border-white/70 bg-white/80 shadow-card" />
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            <div className="h-[28rem] rounded-[1.75rem] border border-white/70 bg-white/80 shadow-card" />
            <div className="h-[28rem] rounded-[1.75rem] border border-white/70 bg-white/80 shadow-card" />
          </div>
        </div>
      </div>
    </div>
  );
}
