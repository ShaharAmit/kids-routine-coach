import { Link } from 'react-router-dom';
import '../styles/legal.css';

export default function TermsPage() {
  return (
    <main className="legal-shell">
      <article className="legal-card">
        <Link to="/" className="back-link">
          Back to Home
        </Link>

        <h1>Terms and Conditions</h1>
        <p className="meta">Kidocoach | Last updated: May 29, 2026</p>

        <section>
          <h2>1. Acceptance</h2>
          <p>
            By accessing Kidocoach, you agree to these Terms and Conditions. If you do not agree, please do
            not use this website or app.
          </p>
        </section>

        <section>
          <h2>2. Service Description</h2>
          <p>
            Kidocoach provides family routine coaching content, onboarding guidance, and app access links.
            Features may evolve over time.
          </p>
        </section>

        <section>
          <h2>3. Children and Parental Responsibility</h2>
          <p>
            Kidocoach is designed for parent-supervised use. Parents and guardians are responsible for all
            setup decisions and child interactions.
          </p>
        </section>

        <section>
          <h2>4. Availability</h2>
          <p>
            We may change, suspend, or discontinue parts of the service at any time. We do not guarantee
            uninterrupted availability.
          </p>
        </section>

        <section>
          <h2>5. Contact</h2>
          <p>For legal questions, contact the Kidocoach team through your official support channel.</p>
        </section>
      </article>
    </main>
  );
}
