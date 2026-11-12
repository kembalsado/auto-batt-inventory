test("unauthenticated request to a dashboard route redirects to /login", async () => {
  const res = await fetch("http://localhost:3000/items", { redirect: "manual" });
  expect(res.status).toBe(307);
  expect(res.headers.get("location")).toContain("/login");
});
