// Dashboard home. Summary cards (total items, low-stock count, today's
// IN/OUT) depend on data that doesn't exist until later tasks (7-9, 12,
// 16) — this is just a placeholder so `/` has a real route inside the
// dashboard shell built in Task 4, rather than colliding with it.
export default function DashboardHomePage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-brand-ink">Dashboard</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Welcome to Auto Batt Inventory.
      </p>
    </div>
  );
}
