"use client";
export default function GlobalError({ reset }) {
  return (
    <html lang="en"><body style={{ fontFamily: "system-ui", padding: 40 }}>
      <h1>Something went wrong</h1>
      <p>The application hit an unexpected error. Please try again.</p>
      <button onClick={() => reset()}>Try again</button>
    </body></html>
  );
}
