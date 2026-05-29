import { Link } from 'react-router-dom';
import '../styles/legal.css';

export default function PrivacyPage() {
  return (
    <main className="legal-shell">
      <article className="legal-card">
        <Link to="/" className="back-link">
          Back to Home
        </Link>

        <h1>Privacy Policy</h1>
        <p className="meta">Kidocoach | Last updated: May 29, 2026</p>

        <section>
          <h2>1. Data We Process</h2>
          <p>
            We may process configuration, usage, and account-related data required to provide routine coaching
            functionality.
          </p>
        </section>

        <section>
          <h2>2. How We Use Data</h2>
          <p>
            Data is used to operate Kidocoach features, improve reliability, and personalize routine
            experiences.
          </p>
        </section>

        <section>
          <h2>3. Third-Party Services</h2>
          <p>
            Kidocoach relies on Firebase and related cloud services for hosting, storage, and backend
            operations.
          </p>
        </section>

        <section>
          <h2>4. Your Choices</h2>
          <p>
            You may request account data access or deletion through official support channels, subject to legal
            obligations.
          </p>
        </section>

        <section>
          <h2>5. Policy Updates</h2>
          <p>
            We may update this policy from time to time. Continued use after updates means you accept the
            revised policy.
          </p>
        </section>
      </article>
    </main>
  );
}
