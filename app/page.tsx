export default function Page() {
  return (
    <main style={{ maxWidth: 720, margin: "40px auto" }}>
      <h1 style={{ margin: 0, fontSize: 34 }}>Project Devi</h1>
      <p style={{ color: "#555" }}>
        Next.js is live. If you saw a 404 before, this fixes it. 🎉
      </p>
      <div style={{ marginTop: 24, padding: 16, border: "1px solid #e5e5e5", borderRadius: 12, background: "white" }}>
        <p>This is the home page at <code>/</code>. We’ll wire the AI later.</p>
      </div>
    </main>
  );
}
