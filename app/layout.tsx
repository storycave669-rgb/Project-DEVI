export const metadata = {
  title: "Project Devi",
  description: "Minimal Next.js app",
};

export default function RootLayout({
  children,
}: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{fontFamily:"system-ui, Arial", margin:0, padding:20, background:"#fafafa"}}>
        {children}
      </body>
    </html>
  );
}
