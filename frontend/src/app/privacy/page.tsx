import React from "react";
import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — ReportAI",
};

export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-24">
      <article className="prose prose-neutral dark:prose-invert max-w-none">
        <h1>Privacy Policy</h1>
        <p className="text-muted-foreground text-sm">Last updated: February 2026</p>

        <h2>1. Information We Collect</h2>
        <p>
          We collect information you provide directly to us, such as when you create an account,
          upload screenshots, or contact us for support. This includes your name, email address,
          and any content you upload (screenshots, screen recordings).
        </p>

        <h2>2. How We Use Your Information</h2>
        <p>
          We use the information we collect to provide, maintain, and improve our services —
          specifically to analyze your screenshots with AI and generate reports on your behalf.
          We do not sell your personal data or share it with third parties for advertising purposes.
        </p>

        <h2>3. Data Storage</h2>
        <p>
          Uploaded files are stored in Cloudflare R2 object storage. Generated reports (PDF and
          LaTeX source) are stored until you delete them or close your account. You can delete
          any report at any time from your dashboard.
        </p>

        <h2>4. Third-Party Services</h2>
        <p>
          We use the following third-party services to operate ReportAI: Google (OAuth
          authentication and Gemini AI), Cloudflare R2 (file storage), Stripe (payment
          processing), and Neon (database hosting). Each service has its own privacy policy.
        </p>

        <h2>5. Cookies</h2>
        <p>
          We use session cookies for authentication only. We do not use tracking or advertising
          cookies.
        </p>

        <h2>6. Your Rights</h2>
        <p>
          You may request deletion of your account and all associated data at any time by
          contacting us. You may also export your reports (PDF/LaTeX) from the dashboard before
          deleting your account.
        </p>

        <h2>7. Contact</h2>
        <p>
          If you have questions about this policy, please open an issue on our GitHub repository
          or contact us via the support email listed on the site.
        </p>
      </article>

      <div className="mt-12 text-sm text-muted-foreground">
        <Link href="/" className="underline hover:text-foreground transition-colors">
          ← Back to home
        </Link>
      </div>
    </main>
  );
}
