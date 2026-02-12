import React from "react";
import Link from "next/link";

export const metadata = {
  title: "Terms of Service — ReportAI",
};

export default function TermsPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-24">
      <article className="prose prose-neutral dark:prose-invert max-w-none">
        <h1>Terms of Service</h1>
        <p className="text-muted-foreground text-sm">Last updated: February 2026</p>

        <h2>1. Acceptance of Terms</h2>
        <p>
          By accessing or using ReportAI, you agree to be bound by these Terms of Service. If you
          do not agree to these terms, please do not use the service.
        </p>

        <h2>2. Description of Service</h2>
        <p>
          ReportAI is an AI-powered tool that analyzes screenshots of software applications and
          generates professional narrative reports in PDF format. The service is intended for
          legitimate documentation purposes such as internship reports, portfolio documentation,
          and sprint summaries.
        </p>

        <h2>3. Acceptable Use</h2>
        <p>
          You agree not to upload content that is illegal, harmful, or infringes on the rights of
          others. You are responsible for ensuring you have the right to upload any screenshots or
          recordings you submit to the service. You may not use the service to generate misleading
          or fraudulent documentation.
        </p>

        <h2>4. Payments and Refunds</h2>
        <p>
          Paid plans are billed as described on the pricing page. One-time report purchases are
          non-refundable once the report has been generated. Monthly subscriptions can be cancelled
          at any time; cancellation takes effect at the end of the current billing period.
        </p>

        <h2>5. Intellectual Property</h2>
        <p>
          You retain ownership of the screenshots you upload and the reports generated from them.
          ReportAI retains rights to its AI pipeline, templates, and platform code. The core
          pipeline is open-source under the MIT license.
        </p>

        <h2>6. Disclaimer of Warranties</h2>
        <p>
          The service is provided "as is" without warranty of any kind. We do not guarantee that
          generated reports will meet your institution's specific requirements. You are responsible
          for reviewing and verifying all AI-generated content before submission.
        </p>

        <h2>7. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by law, ReportAI shall not be liable for any indirect,
          incidental, or consequential damages arising from your use of the service.
        </p>

        <h2>8. Changes to Terms</h2>
        <p>
          We may update these terms from time to time. Continued use of the service after changes
          constitutes acceptance of the updated terms.
        </p>

        <h2>9. Contact</h2>
        <p>
          For questions about these terms, please open an issue on our GitHub repository or use the
          contact information on the site.
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
