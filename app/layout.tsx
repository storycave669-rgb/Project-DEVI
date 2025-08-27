import "./globals.css";

export const metadata = {
  title: "Project Devi",
  description: "Minimal medical Q&A with live sources",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <div className="max-w-4xl mx-auto p-6">{children}</div>
      </body>
    </html>
  );
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, Arial",
          margin: 0,
          padding: 20,
          background: "#fafafa",
        }}
      >
        {children}
      </body>
    </html>
  );
}
